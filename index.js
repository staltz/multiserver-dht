var pull = require('pull-stream');
var toPull = require('stream-to-pull-stream');
var hyperswarm = require('hyperswarm');
var crypto = require('crypto');
var debug = require('debug')('multiserver-dht');

function updateChannelsToHost(serverCfg) {
  return channelsArr => {
    if (!serverCfg.swarm) {
      console.error('Unexpected absence of the local DHT node');
      return 1;
    }

    var amount = channelsArr.length;
    var newChannels = new Set(channelsArr);
    var oldChannels = serverCfg.channels;

    // newChannels minus oldChannels => join
    newChannels.forEach(channel => {
      if (!oldChannels.has(channel)) {
        serverCfg.channels.add(channel);
        var topic = channelToTopic(channel);
        var hexTopic = topic.toString('hex');
        debug('serverNet joining channel %s (%s)', channel, hexTopic);
        serverCfg.swarm.join(topic, {lookup: true, announce: true});
      }
    });

    // oldChannels minus newChannels => leave
    oldChannels.forEach(channel => {
      if (!newChannels.has(channel)) {
        serverCfg.channels.delete(channel);
        var topic = channelToTopic(channel);
        var hexTopic = topic.toString('hex');
        debug('serverNet leaving channel %s (%s)', channel, hexTopic);
        serverCfg.swarm.leave(topic);
      }
    });

    return amount;
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
  var serverCfg = {swarm: undefined, channels: new Set()};
  var clientCfg = {swarm: undefined, topicToInfo: new Map()};

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

      function lazilyCreateServerSwarm(channelsArr) {
        if (!serverCfg.swarm && channelsArr.length > 0) {
          serverCfg.swarm = hyperswarm({ephemeral: false, maxPeers: 1});
          debug('new serverNet created, as non-ephemeral node');
          serverCfg.swarm.on('connection', (socket, details) => {
            debug('serverNet got a %s connection', details.type);
            var stream = toPull.duplex(socket);
            stream.meta = 'dht';
            onConnection(stream);
          });
        }
        return channelsArr;
      }

      function lazilyDestroyServerSwarm(amountChannels) {
        if (amountChannels === 0 && !!serverCfg.swarm) {
          serverCfg.swarm.destroy(() => {
            serverCfg.swarm = undefined;
          });
        }
      }

      var channelsPStream = opts.key ? pull.values([[opts.key]]) : opts.keys;

      pull(
        channelsPStream,
        pull.map(lazilyCreateServerSwarm),
        pull.map(updateChannelsToHost(serverCfg)),
        pull.map(lazilyDestroyServerSwarm),
        pull.drain()
      );

      return () => {
        debug('server shutting down');
        if (serverCfg.swarm) {
          serverCfg.channels.forEach(c => {
            serverCfg.swarm.leave(channelToTopic(c));
          });
        }
        serverCfg.channels.clear();
      };
    },

    client: function(x, cb) {
      var clientOpts = typeof x === 'string' ? this.parse(x) : x;
      var channel = clientOpts.key;
      if (!channel) {
        onError(new Error('multiserver-dht needs a `key` in the address'));
        return;
      }
      if (!clientCfg.swarm) {
        debug('clientNet created, as non-ephemeral node');
        clientCfg.swarm = hyperswarm({ephemeral: false, maxPeers: 1});
        clientCfg.swarm.on('connection', (socket, details) => {
          debug('clientNet got a %s connection', details.type);
          if (!details.client) {
            debug('ERR client connection was accidentally a server connection');
            return;
          }
          var info = clientCfg.topicToInfo.get(details.peer.topic);
          if (!info) {
            debug(
              'no client handler was registered for topic: ' +
                (details.peer.topic || 'undefined').toString()
            );
            return;
          }
          var stream = toPull.duplex(socket);
          stream.meta = 'dht';
          stream.address = 'dht:' + info.channel;
          info.callback(null, stream);
        });
      }

      var topic = channelToTopic(channel);
      clientCfg.topicToInfo.set(topic, {callback: cb, channel: channel});
      var hexTopic = topic.toString('hex');
      debug('clientNet joining channel %s (%s)', channel, hexTopic);
      clientCfg.swarm.join(topic);

      return function() {
        clientCfg.topicToInfo.delete(topic);
        if (!!clientCfg.swarm) {
          clientCfg.swarm.leave(topic);
          if (clientCfg.topicToInfo.size === 0) {
            clientCfg.swarm.destroy(() => {
              clientCfg.swarm = undefined;
            });
          }
        }
      };
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
