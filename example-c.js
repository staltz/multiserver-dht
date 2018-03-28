var pull = require('pull-stream');
var MultiServer = require('multiserver');
var Dht = require('./index');

var ms = MultiServer([Dht({ key: 'japan' })]);

ms.client('dht:japan', function(err, stream) {
  console.log('client got hold of a connection');
  pull(
    pull.values(['alice', 'bob']),
    stream,
    pull.drain(x => {
      console.log(x); // ALICE
      // BOB
    }),
  );
});
