/* eslint-env node */
'use strict';
var path = require('path');
var mergeTrees = require('broccoli-merge-trees');
var Funnel = require('broccoli-funnel');

function toNodeJSBuilder(projectRoot) {
  var esTranspiler = require('broccoli-babel-transpiler');
  var broccoli = require('broccoli-builder');

  let appEnvPath = path.join(projectRoot, 'config', 'environment.js');
  var appEnv = require(appEnvPath);

  let appsMirageConfigPath = path.join(projectRoot, 'mirage');
  var appsMirageConfigTranspiled = esTranspiler(appsMirageConfigPath, { browserPolyfill: true });

  let emberCliMiragePath = __dirname;
  let mirageAddon = Funnel(emberCliMiragePath, {srcDir: 'addon', destDir: 'ember-cli-mirage'});
  var mirageAddonTranspiled = esTranspiler(mirageAddon, { browserPolyfill: true });

  let emberDistDir = path.join(projectRoot, 'node_modules', "ember-source");
  let emberDistSrc = Funnel(emberDistDir, {srcDir: 'dist', include: ['ember.debug.js'],
    getDestinationPath: function(relativePath) {
      if (relativePath === 'ember.debug.js') { return 'ember.js'; }
      return relativePath;
    }
  });
  var mirageNodeJSTree = mergeTrees([appsMirageConfigTranspiled, mirageAddonTranspiled, emberDistSrc]);
  var builder = new broccoli.Builder(mirageNodeJSTree);
  return builder;
}

function setupImportEmberFromNodeJSOutput(output) {
  /* !!! Hack: add we need node.js module to locate our 'ember.js for `import ember` */
  var Module = require('module').Module;
  var ember = require(path.join(output.directory,'ember.js'));
  Module.globalPaths.push(output.directory);
  process.env['NODE_PATH'] = output.directory;
  Module._initPaths();
  return ember;
}

class ExpressInterceptor {}

function createExpressInterceptor(server) {
  return new ExpressInterceptor(); // TODO
}

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

  serverMiddleware: function(config) {
    if (this.addonBuildConfig.express) {
      var builder = toNodeJSBuilder(this.app.project.root)
      builder.build().then(function(output) {
        var mirageConfig = require(path.join(output.directory,'config.js'));
        var ember = setupImportEmberFromNodeJSOutput(output);
        var scenario = require(path.join(output.directory,'scenarios','default.js'));
        var server = require(path.join(output.directory,'ember-cli-mirage','server.js'));
        let serverWithExpress = new server.default({createInterceptor: createExpressInterceptor.bind({expressApp: config.app})});
        scenario(serverWithExpress);
      }).catch(function(err) {
        console.log('Error during build for node.js:', err);
      }).finally(function() {
        console.log('Build for node.js finished!');
      });
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
    if (process.env.EMBER_CLI_FASTBOOT) {
      return false;
    }

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
