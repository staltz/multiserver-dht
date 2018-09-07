var pull = require('pull-stream');
var toPull = require('stream-to-pull-stream');
var swarm = require('discovery-swarm');

function createPeer(_opts) {
  var swarmOpts = _opts || {};
  delete swarmOpts.key;
  delete swarmOpts.keys;
  swarmOpts.dns = typeof swarmOpts.dns === 'undefined' ? false : swarmOpts.dns;

  var port = swarmOpts.port || 8007;
  delete swarmOpts.port;

  var sw = swarm(swarmOpts);
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

function hostOnChannel(onError, serverPeer) {
  return channel => {
    if (!serverPeer) {
      var msg = 'Unexpected absence of the DHT server';
      if (onError) onError(new Error(msg));
      else console.error(msg);
      return;
    }

    serverPeer.join(channel, {}, err => {
      if (err) {
        if (onError) onError(err);
        serverPeer.channels.delete(channel);
        if (serverPeer.channels.size === 0) {
          serverPeer.removeListener('connection', serverPeer.listener);
        }
        serverPeer.leave(channel);
      } else {
        serverPeer.channels.add(channel);
      }
    });
  };
}

module.exports = function makePlugin(opts) {
  var serverPeer = undefined;
  var clientPeers = {};

  return {
    name: 'dht',

    server: function(onConnection, onError) {
      if (!opts.key && !opts.keys) {
        if (onError) {
          onError(new Error('multiserver-dht needs a `key` or `keys` config'));
        }
        return;
      }
      var channel = opts.key;
      var channels = opts.keys;
      if (!serverPeer) {
        serverPeer = createPeer(opts);
        serverPeer.listener = (stream, info) => {
          onConnection(toPull.duplex(stream), info);
        };
        serverPeer.channels = new Set();
        serverPeer.on('connection', serverPeer.listener);
      }

      pull(
        channel ? pull.values([channel]) : channels,
        pull.drain(hostOnChannel(onError, serverPeer))
      );

      return () => {
        serverPeer.removeListener('connection', serverPeer.listener);
        serverPeer.channels.forEach(c => serverPeer.leave(c));
        serverPeer.channels.clear();
      };
    },

    client: function(x, cb) {
      var clientOpts = typeof x === 'string' ? this.parse(x) : x;
      ['id', 'dns', 'dht', 'utp', 'tcp', 'port'].forEach(name => {
        copyIfDefined(name, opts, clientOpts);
      });
      var channel = clientOpts.key;
      delete clientOpts.key;
      if (!channel) {
        onError(new Error('multiserver-dht needs a `key` in the address'));
        return;
      }
      if (!clientPeers[channel]) {
        clientPeers[channel] = createPeer(clientOpts, cb);
      }
      var clientPeer = clientPeers[channel];
      var connected = false;
      var listener = (stream, info) => {
        if (!connected) {
          connected = true;
          cb(null, toPull.duplex(stream), info);
        }
      };
      var closeOnError = err => {
        if (err) {
          clientPeer.removeListener('connection', listener);
          clientPeer.leave(channel);
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
      var parts = address.split(':');
      if (!parts[1] || !parts[2]) return null;
      var name = parts[1];
      var key = parts[2];
      if (name !== 'dht') return null;
      if (!key || typeof key !== 'string') return null;
      return {name: 'dht', key: key};
    },

    stringify: function() {
      return 'dht:' + opts.key;
    },
  };
};
