var toPull = require('stream-to-pull-stream');
var swarm = require('discovery-swarm');

var peer = undefined;

function createPeer(_opts, onError) {
  var swarmOpts = _opts || {};
  swarmOpts.dns = typeof swarmOpts.dns === 'undefined' ? false : swarmOpts.dns;

  var port = swarmOpts.port || 8007;
  delete swarmOpts.port;

  var sw = swarm(swarmOpts);
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
      if (!peer) peer = createPeer(opts, onError);
      var listener = (stream, info) => {
        onConnection(toPull.duplex(stream), info);
      };
      var close = () => {
        peer.removeListener('connection', listener);
        peer.leave(channel);
      };
      peer.join(channel, {}, err => {
        if (err) {
          onError(err);
          close();
        }
      });
      peer.on('connection', listener);
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
      if (!peer) peer = createPeer(clientOpts, cb);
      var connected = false;
      var listener = (stream, info) => {
        if (
          !connected &&
          info.channel &&
          info.channel.toString('ascii') === channel
        ) {
          connected = true;
          cb(null, toPull.duplex(stream), info);
        }
      };
      var closeOnError = err => {
        if (err) {
          peer.removeListener('connection', listener);
          peer.leave(channel);
          cb(err);
        }
      };
      peer.join(channel, {}, closeOnError);
      peer.on('connection', listener);
      peer.on('connection-closed', (conn, info) => {
        if (info.channel && info.channel.toString('ascii') === channel) {
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
