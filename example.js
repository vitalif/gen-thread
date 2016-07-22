var gen = require('./gen-thread.js');

function* test()
{
    console.log('start');
    var cb = gen.unsafe();
    console.log([ 'next', yield setTimeout(function() { cb('zhopa', 123); }, 500) ]);
    var args = yield gen.runParallel([
        (function*()
        {
            var cb = gen.unsafe();
            yield setTimeout(function() { cb('callback 1'); }, 500);
            return 'result 1';
        })(),
        (function*()
        {
            var cb = gen.unsafe();
            yield setTimeout(function() { cb('callback 2'); }, 500);
            return 'result 2';
        })()
    ], gen.cb());
    console.log('abc');
    console.log(args);
    return 'result';
}

function* test_throttle()
{
    yield gen.throttle(5);
    console.log('at most 5');
    yield setTimeout(gen.cb(), 1000);
    console.log('continue in another generator');
    yield* other_gen(); // same as 'yield gen.run(other_gen, gen.cb())'
}

function* other_gen()
{
    yield setTimeout(gen.cb(), 1000);
    console.log('finished in another generator');
}

function* test_throw()
{
    var cb = gen.errorfirst();
    try
    {
        yield setTimeout(function() { cb(new Error()); }, 500);
    }
    catch (e)
    {
        console.log('Catched '+e.stack);
    }
    console.log(yield setTimeout(gen.cb(), 500));
    console.log('sleep');
    console.log(yield setTimeout(gen.cb(), 500));
    console.log('continue');
}

gen.run(test, function(result) { console.log(result); });

for (var i = 0; i < 15; i++) gen.run(test_throttle);

gen.run(test_throw);
