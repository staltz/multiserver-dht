var toPull = require('stream-to-pull-stream');
var swarm = require('discovery-swarm');

var serverPeer = undefined;
var clientPeers = {};

function createPeer(_opts, onError) {
  var swarmOpts = _opts || {};
  swarmOpts.dns = typeof swarmOpts.dns === 'undefined' ? false : swarmOpts.dns;

  var port = swarmOpts.port || 8007;
  delete swarmOpts.port;

  var sw = swarm(swarmOpts);
  swarm.once('error', () => {
    swarm.listen(0);
  });
  sw.listen(port);
  return sw;
}

function copyIfDefined(propName, origin, destination) {
  if (typeof origin[propName] !== 'undefined') {
    destination[propName] = origin[propName];
  }
}

module.exports = function makePlugin(opts) {
  return {
    name: 'dht',

    server: function(onConnection, onError) {
      var channel = opts.key;
      delete opts.key;
      if (!channel) {
        onError(new Error('multiserver-dht is missing a `key` config'));
        return;
      }
      if (!serverPeer) serverPeer = createPeer(opts, onError);
      var listener = (stream, info) => {
        onConnection(toPull.duplex(stream), info);
      };
      var close = () => {
        serverPeer.removeListener('connection', listener);
        serverPeer.leave(channel);
      };
      serverPeer.join(channel, {}, err => {
        if (err) {
          onError(err);
          close();
        }
      });
      serverPeer.on('connection', listener);
      return close;
    },

    client: function(x, cb) {
      var clientOpts = typeof x === 'string' ? this.parse(x) : x;
      ['id', 'dns', 'dht', 'utp', 'tcp', 'port'].forEach(name => {
        copyIfDefined(name, opts, clientOpts);
      });
      var channel = clientOpts.key;
      delete clientOpts.key;
      if (!channel) {
        onError(new Error('multiserver-dht is missing a `key` config'));
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
      var parts = address.split(':');
      if (parts.length < 2) return null;
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
