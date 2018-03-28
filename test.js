var pull = require('pull-stream');
var test = require('tape');
var Pushable = require('pull-pushable');
var MultiServer = require('multiserver');
var Dht = require('./index');

test('basic server and client work correctly', function(t) {
  t.plan(7);

  // WEIRD HACK necessary because of how discovery-swarm internally
  // handles duplicate connections detected in handshake:
  var smallNum = '2';
  var largeNum = '5';

  var msS = MultiServer([
    Dht({
      key: 'multiserver-dht-test',
      id: largeNum,
      dns: true,
      dht: false,
      utp: false,
      port: 58006,
    }),
  ]);

  var msC = MultiServer([
    Dht({
      key: 'multiserver-dht-test',
      id: smallNum,
      dns: true,
      dht: false,
      utp: false,
      port: 58007,
    }),
  ]);

  msS.server(function(stream, info) {
    t.pass('server initialized successfully');
    pull(
      stream,
      pull.map(buf => buf.toString('utf-8')),
      pull.map(s => s.toUpperCase()),
      pull.map(str => Buffer.from(str, 'utf-8')),
      stream,
    );
  });

  msC.client('dht:multiserver-dht-test', function(err, stream, info) {
    t.error(err, 'client initialized successfully');
    var gotResponse = false;

    var pushable = Pushable();
    pull(
      pushable,
      stream,
      pull.drain(res => {
        t.false(gotResponse, 'got the first and only response');
        gotResponse = true;
        t.equals(typeof res, 'object', 'response is an object');
        t.true(res instanceof Buffer, 'actually a buffer');
        t.equals(res.toString('utf-8'), 'HELLO WORLD', 'got HELLO WORLD');
        pushable.end();
        t.end();
      }),
    );

    t.pass('sent request: hello world');
    pushable.push('hello world');
  });
});

test('teardown', function(t) {
  t.end();
  process.exit(0);
});
