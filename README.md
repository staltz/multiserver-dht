# multiserver-dht

_A [multiserver](https://github.com/ssbc/multiserver) plugin that uses a Distributed Hash Table and channel keys as addresses_

```
npm install --save multiserver-dht
```

This module is a multiserver plugin that joins a Distributed Hash Table (DHT) and uses channel keys as "addresses" where peers communicate as clients and as servers. Uses [hyperswarm](https://github.com/hyperswarm) under the hood.

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

* `key` (REQUIRED unless `keys` is present), a string identifying the channel to be used as address.
* `keys` (REQUIRED unless `key` is present), a pull-stream of arrays of strings that identify all the channels where servers are hosted.

Returns a multiserver plugin.
