var pull = require('pull-stream');
var MultiServer = require('multiserver');
var Dht = require('./index');

var ms = MultiServer([Dht({keys: pull.values(['brazil', 'germany'])})]);

ms.server(function(stream, info) {
  console.log('server got a client');
  console.log(info);
  pull(
    stream,
    pull.map(buf => buf.toString('utf-8')),
    pull.map(s => s.toUpperCase()),
    pull.map(str => Buffer.from(str, 'utf-8')),
    stream
  );
});
