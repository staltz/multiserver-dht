var toPull = require('stream-to-pull-stream');
var swarm = require('discovery-swarm');

function createPeer(_opts, onError) {
  var swarmOpts = _opts || {};
  swarmOpts.dns = false;

  var key = swarmOpts.key;
  if (!key) {
    onError(new Error('multiserver-dht is missing a `key` config'));
    return;
  }
  swarmOpts.key = void 0;

  var port = swarmOpts.port || 8007;
  swarmOpts.port = void 0;

  var sw = swarm(swarmOpts);
  sw.listen(port);
  sw.join(key, {}, err => {
    if (err) {
      onError(err);
      sw.close();
    }
  });
  return sw;
}

module.exports = function makePlugin(opts) {
  return {
    name: 'worker',

    server: function(onConnection, onError) {
      var peer = createPeer(opts, onError);
      if (!peer) return;
      peer.on('connection', (stream, info) => {
        onConnection(toPull.duplex(stream), info);
      });
      return function() {
        peer.close();
      };
    },

    client: function(x, cb) {
      var clientOpts = typeof x === 'string' ? this.parse(x) : x;
      var peer = createPeer(clientOpts, cb);
      if (!peer) return;
      var connected = false;
      peer.on('connection', stream => {
        if (!connected) {
          connected = true;
          cb(null, toPull.duplex(stream));
        }
      });
    },

    // MUST be dht:<key>
    parse: function(address) {
      var parts = address.split(':');
      if (parts.length !== 2) return null;
      var name = parts[0];
      var key = parts[1];
      if (name !== 'dht') return null;
      if (!key || typeof key !== 'string') return null;
      return { name: 'dht', key: key };
    },

    stringify: function() {
      return 'dht:' + opts.key;
    },
  };
};
