var pull = require('pull-stream');
var toPull = require('stream-to-pull-stream');
var datDefaults = require('dat-swarm-defaults');
var swarm = require('discovery-swarm');

function createPeer(_opts) {
  var swarmOpts = Object.assign({}, _opts || {});
  delete swarmOpts.key;
  delete swarmOpts.keys;
  swarmOpts.dns = typeof swarmOpts.dns === 'undefined' ? false : swarmOpts.dns;

  var port = swarmOpts.port || 0;
  delete swarmOpts.port;

  var sw = swarm(datDefaults(swarmOpts));
  sw.once('error', () => {
    sw.listen(0);
  });
  sw.listen(port);
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
        serverCfg.peer.join(channel, {}, err => {
          if (!err) return;
          if (onError) onError(err);
          serverCfg.channels.delete(channel);
          serverCfg.peer.leave(channel);
        });
      }
    });

    // oldChannels minus newChannels => leave
    oldChannels.forEach(channel => {
      if (!newChannels.has(channel)) {
        serverCfg.channels.delete(channel);
        serverCfg.peer.leave(channel);
      }
    });

    return amount;
  };
}

module.exports = function makePlugin(opts) {
  opts = opts || {};
  var serverCfg = {peer: null, channels: new Set(), listener: null};
  var clientPeers = new Map();

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
          serverCfg.channels.forEach(c => serverCfg.peer.leave(c));
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
      if (!clientPeers.has(channel)) {
        clientPeers.set(channel, createPeer(clientOpts, cb));
      }
      var clientPeer = clientPeers.get(channel);
      var connected = false;
      var listener = (stream, info) => {
        if (!connected) {
          connected = true;
          const s = toPull.duplex(stream);
          s.meta = 'dht';
          cb(null, s, info);
        }
      };
      var closeOnError = err => {
        if (err) {
          clientPeers.delete(channel);
          clientPeer.removeListener('connection', listener);
          clientPeer.leave(channel);
          clientPeer.close();
          cb(err);
        }
      };
      clientPeer.join(channel, {}, closeOnError);
      clientPeer.on('connection', listener);
      clientPeer.on('connection-closed', (conn, info) => {
        if (connected) {
          connected = false;
          closeOnError(new Error('connection lost, channel: ' + channel));
        }
      });
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
