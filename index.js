/* eslint-env node */
'use strict';
var path = require('path');
var mergeTrees = require('broccoli-merge-trees');
var Funnel = require('broccoli-funnel');
var FastBoot = require('fastboot');

module.exports = {
  name: 'ember-cli-mirage',

  options: {
    nodeAssets: {
      'route-recognizer': npmAsset({
        path: 'dist/route-recognizer.js',
        sourceMap: 'dist/route-recognizer.js.map'
      }),
      'fake-xml-http-request': npmAsset('fake_xml_http_request.js'),
      'pretender': npmAsset('pretender.js'),
      'faker': npmAsset('build/build/faker.js')
    }
  },

  serverMiddleware: function(options) {
    if (this.addonConfig.useExpress) {
      var _this = this;
      var app = options.app;
      this.expressRouter = require('express').Router();
      var router = this.expressRouter;
      app.use(function (req, resp, next) {
        var broccoliHeader = req.headers['x-broccoli'];
        var outputPath = broccoliHeader['outputPath'];
        if (! _this.mirageOnNodeJS) {
          _this.mirageOnNodeJS = new FastBoot({distPath: outputPath, sandboxGlobals: {
            FastBootMirage: { expressRouter: router }}});
        }
        next();
      });
      app.use(router);
    }
  },

  postBuild: function(result) {
    var vendor_js = this.app.options.outputPaths.vendor.js
    var app_js = this.app.options.outputPaths.app.js
    var full_vendor = path.join(result.directory, vendor_js)
    var full_app = path.join(result.directory, app_js)
    console.log("this.app", this.app.name)
    console.log("full_vendor", path.join(result.directory, vendor_js))
    console.log("full_app", path.join(result.directory, app_js))
    console.log("(ember-cli-mirage)[*] postBuild", result, result.directory)
    var vm = require('vm')
    var fs = require('fs')

    var sandbox = {
      // Convince jQuery not to assume it's in a browser
      module: { exports: {} }
    }
    // set global as window
    sandbox.window = sandbox
    sandbox.window.self = sandbox

    //sandbox.document.createElement("foo")
    vm.createContext(sandbox)
    var source = fs.readFileSync(full_vendor, 'utf8');
    var fileScript = new vm.Script(source, { filename: full_vendor })
    fileScript.runInContext(sandbox)

    sandbox.document = {
      querySelector: function (match) {
        if (match === 'meta[name="ember-cli-mirage-fastboots-demo5/config/environment"') {
          console.log("Query selector works!!!");
          return {}
        }
        console.log("Query slector", match)
        return {getAttribute: function(what) {
          console.log("getAttribute", what);
          return "{}"
         }}
      }
    }
    sandbox.setTimeout = function(fn,ms) { console.log("Set timeout", fn, ms) }
    sandbox.FastBootMirage = {}
    sandbox.console = console

    var source = fs.readFileSync(full_app, 'utf8');
    var fileScript = new vm.Script(source, { filename: full_app })
    fileScript.runInContext(sandbox)
    //console.log("Sandbox", sandbox)
    console.log("Whadda", sandbox.requireModule.entries['ember-cli-mirage-fastboots-demo5/initializers/ember-cli-mirage'])
    //sandbox.requireModule.entries['ember-cli-mirage-fastboots-demo5/initializers/ember-cli-mirage'].callback()
    sandbox.require('ember-cli-mirage-fastboots-demo5/initializers/ember-cli-mirage')


    if (this.mirageOnNodeJS) {
      this.expressRouter.stack = []
      this.mirageOnNodeJS.reload({distPath: result.directory})
    }
  },

  included: function included() {
    var app;

    // If the addon has the _findHost() method (in ember-cli >= 2.7.0), we'll just
    // use that.
    if (typeof this._findHost === 'function') {
      app = this._findHost();
    } else {
      // Otherwise, we'll use this implementation borrowed from the _findHost()
      // method in ember-cli.
      var current = this;
      do {
        app = current.app || app;
      } while (current.parent.parent && (current = current.parent));
    }

    this.app = app;
    this.addonConfig = this.app.project.config(app.env)['ember-cli-mirage'] || {};
    this.addonBuildConfig = this.app.options['ember-cli-mirage'] || {};

    // Call super after initializing config so we can use _shouldIncludeFiles for the node assets
    this._super.included.apply(this, arguments);

    if (this.addonBuildConfig.directory) {
      this.mirageDirectory = this.addonBuildConfig.directory;
    } else if (this.addonConfig.directory) {
      this.mirageDirectory = this.addonConfig.directory;
    } else if (app.project.pkg['ember-addon'] && !app.project.pkg['ember-addon'].paths) {
      this.mirageDirectory = path.resolve(app.project.root, path.join('tests', 'dummy', 'mirage'));
    } else {
      this.mirageDirectory = path.join(this.app.project.root, '/mirage');
    }

    if (this._shouldIncludeFiles()) {
      app.import('vendor/ember-cli-mirage/pretender-shim.js', {
        type: 'vendor',
        exports: { 'pretender': ['default'] }
      });
    }
  },

  blueprintsPath: function() {
    return path.join(__dirname, 'blueprints');
  },

  treeFor: function(name) {
    if (!this._shouldIncludeFiles()) {
      return;
    }

    return this._super.treeFor.apply(this, arguments);
  },

  _lintMirageTree: function(mirageTree) {
    var lintedMirageTrees;
    // _eachProjectAddonInvoke was added in ember-cli@2.5.0
    // this conditional can be removed when we no longer support
    // versions older than 2.5.0
    if (this._eachProjectAddonInvoke) {
      lintedMirageTrees = this._eachProjectAddonInvoke('lintTree', ['mirage', mirageTree]);
    } else {
      lintedMirageTrees = this.project.addons.map(function(addon) {
        if (addon.lintTree) {
          return addon.lintTree('mirage', mirageTree);
        }
      }).filter(Boolean);
    }

    var lintedMirage = mergeTrees(lintedMirageTrees, {
      overwrite: true,
      annotation: 'TreeMerger (mirage-lint)'
    });

    return new Funnel(lintedMirage, {
      destDir: 'tests/mirage/'
    });
  },

  treeForApp: function(appTree) {
    var trees = [ appTree ];
    var mirageFilesTree = new Funnel(this.mirageDirectory, {
      destDir: 'mirage'
    });
    trees.push(mirageFilesTree);

    if (this.hintingEnabled()) {
      trees.push(this._lintMirageTree(mirageFilesTree));
    }

    return mergeTrees(trees);
  },

  _shouldIncludeFiles: function() {

    var environment = this.app.env;
    var enabledInProd = environment === 'production' && this.addonConfig.enabled;
    var explicitExcludeFiles = this.addonConfig.excludeFilesFromBuild;
    if (enabledInProd && explicitExcludeFiles) {
      throw new Error('Mirage was explicitly enabled in production, but its files were excluded '
                      + 'from the build. Please, use only ENV[\'ember-cli-mirage\'].enabled in '
                      + 'production environment.');
    }
    return enabledInProd || (environment && environment !== 'production' && explicitExcludeFiles !== true);
  }
};

function npmAsset(filePath) {
  return function() {
    return {
      enabled: this._shouldIncludeFiles(),
      import: [filePath]
    };
  };
}
