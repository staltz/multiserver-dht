var pull = require('pull-stream');
var MultiServer = require('multiserver');
var Dht = require('./index');

var ms = MultiServer([Dht({ key: 'japan' })]);

ms.server(function(stream) {
  console.log('server got a client 8)');
  pull(stream, pull.map(s => s.toUpperCase()), stream);
});
