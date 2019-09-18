var pull = require('pull-stream');
var toPull = require('stream-to-pull-stream');
var network = require('@hyperswarm/network');
var crypto = require('crypto');
var debug = require('debug')('multiserver-dht');

function hostChannels(serverNet, serverChannels) {
  return channels => {
    var newChannels = new Set(channels);
    var oldChannels = serverChannels;

    // newChannels minus oldChannels => add
    newChannels.forEach(channel => {
      if (!oldChannels.has(channel)) {
        serverChannels.add(channel);
        var topic = channelToTopic(channel);
        var hexTopic = topic.toString('hex');
        debug('serverNet joining channel %s (%s)', channel, hexTopic);
        serverNet.join(topic, {lookup: true, announce: true});
      }
    });

    // oldChannels minus newChannels => remove
    oldChannels.forEach(channel => {
      if (!newChannels.has(channel)) {
        serverChannels.delete(channel);
        var topic = channelToTopic(channel);
        var hexTopic = topic.toString('hex');
        debug('serverNet leaving channel %s (%s)', channel, hexTopic);
        serverNet.leave(topic);
      }
    });
  };
}

function channelToTopic(channel) {
  return crypto
    .createHash('sha256')
    .update(channel)
    .digest();
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
      debug('new serverNet created, as non-ephemeral node');
      serverNet.on('connection', (socket, details) => {
        debug('serverNet got a %s connection', details.type);
        var stream = toPull.duplex(socket);
        stream.meta = 'dht';
        onConnection(stream);
      });

      pull(
        channel ? pull.values([[channel]]) : channelsPStream,
        pull.drain(hostChannels(serverNet, serverChannels))
      );

      return () => {
        debug('server shutting down');
        serverChannels.forEach(c => serverNet.leave(channelToTopic(c)));
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
        debug('clientNet created, as non-ephemeral node');
        clientNet = network({ephemeral: false});
        clientNet.on('connection', (socket, details) => {
          debug('clientNet got a %s connection', details.type);
          if (!details.client) {
            debug('ERR client connection was accidentally a server connection');
            return;
          }
          var callback = clientTopicToCb.get(details.peer.topic);
          if (!callback) {
            debug(
              'no client handler was registered for topic: ' +
                (details.peer.topic || 'undefined').toString()
            );
            return;
          }
          var stream = toPull.duplex(socket);
          stream.meta = 'dht';
          callback(null, stream);
        });
      }
      var topic = channelToTopic(channel);
      var hexTopic = topic.toString('hex');
      clientTopicToCb.set(topic, cb);
      debug('clientNet joining channel %s (%s)', channel, hexTopic);
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
