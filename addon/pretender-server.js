import Server from './server';
import createPretender from './interceptors/create-pretender';

class PretenderServer extends Server {
  constructor(options = {}) {
    super(Object.assign({createInterceptor: createPretender}, options));
  }
}

export default PretenderServer;
