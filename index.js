var toPull = require('stream-to-pull-stream');
var swarm = require('discovery-swarm');

function createPeer(_opts, onError) {
  var swarmOpts = _opts || {};
  if (!swarmOpts.key) {
    onError(new Error('multiserver-dht is missing a `key` config'));
    return;
  }
  swarmOpts.port = swarmOpts.port || 8007;
  swarmOpts.dns = false;

  var sw = swarm();
  sw.listen(swarmOpts.port);
  sw.join(swarmOpts.key, {}, err => {
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
      peer.on('connection', stream => {
        onConnection(toPull.duplex(stream));
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
