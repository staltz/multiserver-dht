var pull = require('pull-stream');
var toPull = require('stream-to-pull-stream');
var swarm = require('hyperswarm');
var crypto = require('crypto');

function channelToBuf(channel) {
  return crypto.createHash('sha256').update(channel).digest()
}

function createPeer(_opts) {
  var swarmOpts = Object.assign({}, _opts || {});
  delete swarmOpts.key;
  delete swarmOpts.keys;

  var sw = swarm(swarmOpts)
  return sw;
}

function copyIfDefined(propName, origin, destination) {
  if (typeof origin[propName] !== 'undefined') {
    destination[propName] = origin[propName];
  }
}

function updateChannelsToHost(onError, serverCfg) {
  return channelsArr => {
    if (!serverCfg.peer) {
      var msg = 'Unexpected absence of the DHT server';
      if (onError) onError(new Error(msg));
      else console.error(msg);
      return 1;
    }

    var amount = channelsArr.length;
    var newChannels = new Set(channelsArr);
    var oldChannels = serverCfg.channels;

    // newChannels minus oldChannels => join
    newChannels.forEach(channel => {
      if (!oldChannels.has(channel)) {
        serverCfg.channels.add(channel);
        serverCfg.peer.join(channelToBuf(channel), { lookup: true, announce: true });
      }
    });

    // oldChannels minus newChannels => leave
    oldChannels.forEach(channel => {
      if (!newChannels.has(channel)) {
        serverCfg.channels.delete(channel);
        serverCfg.peer.leave(channelToBuf(channel));
      }
    });

    return amount;
  };
}

module.exports = function makePlugin(opts) {
  opts = opts || {};
  var serverCfg = {peer: null, channels: new Set(), listener: null};

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

      function lazilyCreateServerPeer(channelsArr) {
        if (channelsArr.length > 0 && !serverCfg.peer) {
	  opts.ephemeral = false;
          serverCfg.peer = createPeer(opts);
          serverCfg.listener = (socket, info) => {
            const stream = toPull.duplex(socket);
            stream.meta = 'dht';
            stream.address = info.channel
              ? 'dht:' + info.channel
              : stream.channel
              ? 'dht:' + stream.channel.toString('ascii')
              : 'dht:unknown';
            onConnection(stream, info);
          };
          serverCfg.peer.on('connection', serverCfg.listener);
        }
        return channelsArr;
      }

      function lazilyDestroyServerPeer(amountChannels) {
        if (amountChannels === 0 && !!serverCfg.peer) {
          serverCfg.peer.close(() => {
            serverCfg.peer = null;
          });
        }
        return amountChannels;
      }

      var channelsPStream = opts.key ? pull.values([[opts.key]]) : opts.keys;

      pull(
        channelsPStream,
        pull.map(lazilyCreateServerPeer),
        pull.map(updateChannelsToHost(onError, serverCfg)),
        pull.map(lazilyDestroyServerPeer),
        pull.drain()
      );

      return () => {
        if (!!serverCfg.peer) {
          serverCfg.channels.forEach(c => serverCfg.peer.leave(channelToBuf(c)));
          serverCfg.peer.removeListener('connection', serverCfg.listener);
          serverCfg.peer.close(() => {
            serverCfg.peer = null;
          });
        }
        serverCfg.channels.clear();
      };
    },

    client: function(x, cb) {
      var clientOpts = typeof x === 'string' ? this.parse(x) : x;
      ['id', 'dns', 'dht', 'utp', 'tcp'].forEach(name => {
        copyIfDefined(name, opts, clientOpts);
      });
      var channel = clientOpts.key;
      delete clientOpts.key;
      if (!channel) {
        onError(new Error('multiserver-dht needs a `key` in the address'));
        return;
      }
      // Use ephemeral mode for the client so it works in a web browser context.
      clientOpts.ephemeral = true;
      var clientPeer = createPeer(clientOpts, cb);
      var connected = false;
      var listener = (stream, info) => {
        if (!connected) {
          connected = true;
          const s = toPull.duplex(stream);
          s.meta = 'dht';
          s.address = 'dht:' + channel;
          cb(null, s, info);
        }
      };
      var closeOnError = err => {
        if (err) {
          clientPeer.removeListener('connection', listener);
          clientPeer.leave(channelToBuf(channel));
          cb(err);
        }
      };
      clientPeer.join(channelToBuf(channel), { lookup: true, announce: true });
      clientPeer.on('connection', listener);
      clientPeer.on('connection-closed', (conn, info) => {
        if (connected) {
          connected = false;
          closeOnError(new Error('connection lost, channel: ' + channel));
        }
      });

      return () => {
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
