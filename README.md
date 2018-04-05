# multiserver-dht

_A [multiserver](https://github.com/ssbc/multiserver) plugin that uses a Distributed Hash Table and channel keys as addresses_

```
npm install --save multiserver-dht
```

This module is a multiserver plugin that joins a Distributed Hash Table (DHT) and uses channel keys as "addresses" where peers communicate as clients and as servers.

Only supports one DHT peer _per process_. In other words, the DHT peer is a singleton once the module is imported.

## Usage

As client:

```js
var pull = require('pull-stream');
var Pushable = require('pull-pushable');
var MultiServer = require('multiserver');
var Dht = require('multiserver-dht');

var ms = MultiServer([Dht({ key: 'japan' })]);

ms.client('dht:japan', function(err, stream) {
  var pushable = Pushable();
  pull(
    pushable,
    stream,
    pull.drain(x => {
      console.log(buf.toString('utf-8'));
      // ALICE
      // BOB
    }),
  );
  pushable.push('alice');
  pushable.push('bob');
});
```

As server:

```js
var pull = require('pull-stream');
var MultiServer = require('multiserver');
var Dht = require('multiserver-dht');

var ms = MultiServer([Dht({ key: 'japan' })]);

ms.server(function(stream) {
  pull(
    stream,
    pull.map(buf => buf.toString('utf-8')),
    pull.map(s => s.toUpperCase()),
    pull.map(str => Buffer.from(str, 'utf-8')),
    stream,
  );
});
```

## API

### `Dht(opts)`

Joins a global Distributed Hash Table on the Internet under the channel `opts.key` as the address. The `opts` may include:

* `key` (REQUIRED), a string identifying the channel to be used as address.
* `port`, the port on which to listen for connections in the DHT. Default: 8007
* `id` a string identifying this specific DHT peer. Default: something random

Returns a multiserver plugin.
