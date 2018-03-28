var pull = require('pull-stream');
var MultiServer = require('multiserver');
var Dht = require('./index');

var ms = MultiServer([Dht({ key: 'japan' })]);

ms.server(function(stream, info) {
  console.log('server got a client');
  console.log(info);
  pull(stream, pull.map(s => s.toUpperCase()), stream);
});
