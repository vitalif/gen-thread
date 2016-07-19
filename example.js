var gen = require('./gen-thread.js');

function* test(thread)
{
    console.log('start');
    console.log([ 'next', yield setTimeout(function() { thread('zhopa', 123); }, 500) ]);
    var args = yield gen.runParallel([
        function*(thread)
        {
            yield setTimeout(function() { thread('callback 1'); }, 500);
            return 'result 1';
        },
        function*(thread)
        {
            yield setTimeout(function() { thread('callback 2'); }, 500);
            return 'result 2';
        }
    ], thread);
    console.log('abc');
    console.log(args);
    return 'result';
}

gen.run(test, null, function(result) { console.log(result); });

function* test_throttle(thread)
{
    yield thread.throttle(5);
    console.log('at most 5');
    yield setTimeout(thread, 1000);
    console.log('continue in another generator');
    yield other_gen(thread);
}

function* other_gen(thread)
{
    yield setTimeout(thread, 1000);
    console.log('finished in another generator');
}

for (var i = 0; i < 15; i++)
    gen.run(test_throttle);
