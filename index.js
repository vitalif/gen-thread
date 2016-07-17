module.exports.run = runThread;
module.exports.runParallel = runParallel;

var q = [];
var pending = [];

function finishq()
{
    for (var i = 0; i < q.length; i++)
    {
        if (q[i]._done)
        {
            q.splice(i, 1);
            i--;
        }
    }
    while (pending.length > 0 && q.length < pending[0][2])
    {
        var t = pending.shift();
        q.push(t[0]);
        process.nextTick(t[1]);
    }
}

var tid = 0;
function runThread(main, arg, done)
{
    var thread = function()
    {
        // pass parameters as yield result
        var pass = Array.prototype.slice.call(arguments, 0);
        var v;
        try
        {
            v = thread.gen.next(pass);
        }
        catch (e)
        {
            v = { done: 1, error: e };
        }
        if (v.done)
        {
            thread._done = true;
            process.nextTick(finishq);
        }
        if (v.error)
            throw v.error;
        if (v.done && done)
            done(v.value);
    };
    thread.id = tid++;
    thread.gen = main(thread, arg);
    thread.throttle = function(count)
    {
        finishq();
        if (q.length < count)
        {
            q.push(thread);
            process.nextTick(thread.cb());
        }
        else
        {
            pending.push([ thread, thread.cb(), count ]);
        }
    };
    thread.cb = function()
    {
        var fn = function()
        {
            if (thread._current != fn)
            {
                throw new Error('Broken control flow! Callback'+
                    thread._current._stack.replace(/^\s*Error\s*at Function\.thread\.cb\s*\([^)]*\)/, '')+
                    '\nmust be called to resume thread, but this one is called instead:'+
                    fn._stack.replace(/^\s*Error\s*at Function\.thread\.cb\s*\([^)]*\)/, '')+'\n--'
                );
            }
            return thread.apply(thread, arguments);
        };
        fn._stack = new Error().stack;
        thread._current = fn;
        return fn;
    };
    thread();
}

function runParallel(threads, done)
{
    var results = [];
    var resultCount = 0;
    var allDone = function(i, result)
    {
        if (!results[i])
        {
            results[i] = result;
            resultCount++;
            if (resultCount == threads.length)
                done(results);
        }
    };
    threads.map((t, i) => runThread(t, null, function(result) { allDone(i, result); }));
}
