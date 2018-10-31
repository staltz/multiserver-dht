var pull = require('pull-stream');
var toPull = require('stream-to-pull-stream');
var network = require('@hyperswarm/network');

function hostChannels(serverNet, serverChannels) {
  return channels => {
    var newChannels = new Set(channels);
    var oldChannels = serverChannels;

    // newChannels minus oldChannels => add
    newChannels.forEach(channel => {
      if (!oldChannels.has(channel)) {
        serverChannels.add(channel);
        serverNet.join(Buffer.from(channel), {lookup: true, announce: true});
      }
    });

    // oldChannels minus newChannels => remove
    oldChannels.forEach(channel => {
      if (!newChannels.has(channel)) {
        serverChannels.delete(channel);
        serverNet.leave(Buffer.from(channel));
      }
    });
  };
}

module.exports = function makePlugin(opts) {
  opts = opts || {};
  var serverChannels = new Set();
  var clientNet = undefined;
  var clientTopicToCb = new Map();

  return {
    name: 'dht',

    scope: function() {
      return opts.scope || 'public';
    },

    server: function(onConnection, onError) {
      if (!opts.key && !opts.keys) {
        if (onError) {
          onError(new Error('multiserver-dht needs a `key` or `keys` config'));
        }
        return;
      }
      var channel = opts.key;
      var channelsPStream = opts.keys;

      var serverNet = network({ephemeral: false});
      serverNet.on('connection', (socket, _details) => {
        var stream = toPull.duplex(socket);
        stream.meta = 'dht';
        onConnection(stream);
      });

      pull(
        channel ? pull.values([[channel]]) : channelsPStream,
        pull.drain(hostChannels(serverNet, serverChannels))
      );

      return () => {
        serverChannels.forEach(c => serverNet.leave(Buffer.from(c)));
        serverChannels.clear();
      };
    },

    client: function(x, cb) {
      var clientOpts = typeof x === 'string' ? this.parse(x) : x;
      var channel = clientOpts.key;
      if (!channel) {
        onError(new Error('multiserver-dht needs a `key` in the address'));
        return;
      }
      if (!clientNet) {
        clientNet = network({ephemeral: true});
        clientNet.on('connection', (socket, details) => {
          if (!details.client) {
            cb(
              new Error(
                'client connection was accidentally a server connection'
              )
            );
            return;
          }
          var cb = clientTopicToCb.get(details.peer.topic);
          if (!cb) {
            cb(
              new Error(
                'no client handler was registered for topic: ' +
                  (details.peer.topic || 'undefined').toString()
              )
            );
            return;
          }
          var stream = toPull.duplex(socket);
          stream.meta = 'dht';
          cb(null, stream);
        });
      }
      var topic = Buffer.from(channel);
      clientTopicToCb.set(topic, cb);
      clientNet.join(topic);
    },

    // MUST be dht:<key>
    parse: function(address) {
      var parts = address.match(/^([^:]+):(.*)$/);
      if (!parts[1] || !parts[2]) return null;
      var name = parts[1];
      var key = parts[2];
      if (name !== 'dht') return null;
      if (!key || typeof key !== 'string') return null;
      return {name: 'dht', key: key};
    },

    stringify: function() {
      if (opts.key) return 'dht:' + opts.key;
      else return undefined;
    },
  };
};
