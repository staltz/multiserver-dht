var pull = require('pull-stream');
var Pushable = require('pull-pushable');
var MultiServer = require('multiserver');
var Dht = require('./index');

var ms = MultiServer([Dht({ key: 'germany' })]);

ms.client('dht:germany', function(err, stream, info) {
  var pushable = Pushable();
  if (err) {
    console.error(err);
    return;
  }
  console.log('client got hold of a connection');
  console.log(info);
  pull(
    pushable,
    pull.through(s => console.log('req: ' + s)),
    stream,
    pull.drain(buf => {
      console.log('res: ' + buf.toString('utf-8'));
    }),
  );

  setTimeout(() => pushable.push('alice'), 1000);
  setTimeout(() => pushable.push('bob'), 2000);
});
