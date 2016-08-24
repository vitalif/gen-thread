# gen-thread

Yet another generator-based control flow library for node.js. Similar to `gene`, but safer.

Features:
- does not require async/await support
- does not require promisification of existing callback-based code (but also supports promises)
- safely checks control flow and reports exceptions

## Install

`npm install gen-thread`

## Basic example

Consider a `node-postgres` example with error-first style callbacks:

```js
const pg = require('pg');

function makeQueries(callback)
{
  var client = new pg.Client();
  client.connect(function (err)
  {
    if (err) throw err;

    // execute a query on our database
    client.query('SELECT $1::text as name', ['brianc'], function (err, result)
    {
      if (err) throw err;

      // disconnect the client
      client.end(function (err) {
        if (err) throw err;

        // send the result back to caller
        callback(result);
      });
    });
  });
}

makeQueries(function(result)
{
  // just print the result to the console
  console.log(result.rows[0]); // outputs: { name: 'brianc' }
});
```

Let's see what it would look like with gen-thread?

```js
const gen = require('gen-thread');
const pg = require('pg');

// Declare a generator function
function* makeQueries()
{
  var client = new pg.Client();

  // gen.ef() means `generate an error-first callback for passing to an asynchronous task`
  yield client.connect(gen.ef());

  // `yield` returns the array of all callback arguments,
  // except the first one in case of gen.ef() - it's checked for an exception
  var result = (yield client.query('SELECT $1::text as name', ['brianc'], gen.ef()))[0];

  console.log(result.rows[0]);

  // gen.ef() will rethrow asynchronous exceptions with the correct stack
  // (you'll see that the exception is originated from the calling generator)
  yield client.end(gen.ef());

  // just return the result in the end, as always
  return result;
}

gen.run(makeQueries(), function(result)
{
  // just print the result to the console
  console.log(result.rows[0]); // outputs: { name: 'brianc' }
}, function(e)
{
  // called in case of an exception. if not specified, the exception will be just thrown in the wild.
  throw e;
});
```

Here you declare a generator / coroutine / logical "thread" which waits for various
asynchronous events and resumes when they happen while maintaining the local state.

## Plain callback APIs (non error-first)

Use `gen.cb()` instead of `gen.ef()` for plain callback APIs:

```js
yield setTimeout(gen.cb(), 300);
```

## Safe checking of control flow

`gen-thread` remembers the last generated callback and only allows to resume your "coroutine" with
that callback. This allows to check for forgotten `yields` and out-of-order calls (which usually occur
if you try to handle event streams with a coroutine). Example:

```js
const gen = require('gen-thread');

function* makeQueries()
{
  var client = new pg.Client();
  client.connect(gen.ef());
  var result = (yield client.query('SELECT $1::text as name', ['brianc'], gen.ef()))[0];
  // EXCEPTION: Callback at line 6... must be called to resume thread, but this one is called instead: at line 7...
}
```

You may also explicitly use an "unsafe" callback (but be careful):

```js
function* handleStream(emitter)
{
  emitter.on('event', gen.unsafe());
  emitter.once('end', gen.unsafe());
  while (event = yield 1)
  {
    // no more yields here! or you'll get out-of-order execution
  }
}
```

## Correct exception reporting

Asynchronous errors do not have meaningful stack traces because they usually originate from the node.js event loop.
`gen.ef()` and `gen.p()` add a stack trace of the original caller to the reported error, like:

```
node_modules/gen-thread/index.js:103
            throw v.error;
            ^

error: relation "instances" does not exist
    at startPostgresListener (your-script.js:770:32)
    at next (native)
    at callGen (node_modules/gen-thread/index.js:75:36)
    at Object.runThread [as run] (node_modules/gen-thread/index.js:50:5)
    at Object.<anonymous> (your-script.js:52:5)
    at Module._compile (module.js:409:26)
    at Object.Module._extensions..js (module.js:416:10)
    at Module.load (module.js:343:32)
    at Function.Module._load (module.js:300:12)
-- async error thrown at:
    at Connection.parseE (node_modules/pg/lib/connection.js:554:11)
    at Connection.parseMessage (node_modules/pg/lib/connection.js:381:17)
    at Socket.<anonymous> (node_modules/pg/lib/connection.js:117:22)
    at emitOne (events.js:77:13)
    at Socket.emit (events.js:169:7)
    at readableAddChunk (_stream_readable.js:146:16)
    at Socket.Readable.push (_stream_readable.js:110:10)
    at TCP.onread (net.js:523:20)
```

## Promise support

As you see gen-thread is very similar to async/await, except that it doesn't require Promisified APIs.

But it also supports promises.

The value you actually `yield` means nothing when you use callbacks (gen.ef() or gen.cb()).
For example, `yield client.connect(gen.ef());` and `client.connect(gen.ef()); yield 1;` are the same.

But if the yielded value is a Promise (i.e. if it's "then-able", an object with .then() method),
`gen-thread` will wait for it to resolve/reject. This allows to also use promise-based APIs almost
the same as with `await`:

```js
yield client.connect();
```

The only problem here is error reporting - promises do not have stack trace information and we can't force
them to have it without additional actions. So if you want exceptions to be reported correctly, use `gen.p()`:

```js
yield gen.p(client.connect());
```

`gen.p()` captures stack trace to report it if promise fails.

## Throttling

`gen-thread` also includes simple implementation of "throttling" the number of concurrently running
generator of same type. Call `yield gen.throttle(NUMBER)` inside your generator function and it
will ensure that no more than NUMBER instances of this generator passed till this instruction and
are running at the same time. Any additional instances will block on this `yield` until one of
running ones finish.

## API reference

* `gen.run(generatorFunction, onComplete, onError)`: run a cothread,
  invoke onComplete(returnValue) when it completes successfully,
  invoke onError(exception) or just throw exception if it completes with error.
  You can use it like `gen.run(yourGenerator(...your arguments...))` or like `gen.run(yourGenerator)`,
  in latter case it will be invoked without arguments.
* `gen.cb()`: generate a callback to resume current cothread. use as a callback argument for APIs you call before yield'ing.
* `gen.ef()`: generate an error-first style callback to resume current cothread.
* `gen.unsafe()`: generate an unsafe callback to resume current cothread (does not check control flow).
* `gen.p(promise)`: add stack information to promise before yielding it and return it back.
* `gen.runParallel([ generator1, generator2, ... ], onComplete)`: run multiple cothreads
  in parallel, invoke `onComplete([ result1, result2, ... ], [ error1, error2, ... ])` when all finish.

# License

MIT-like.

Copyright (c) 2016+ Vitaliy Filippov (vitalif ~ mail.ru)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
