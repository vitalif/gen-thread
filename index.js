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
    while (pending.length > 0 && q.length < pending[0][1])
    {
        var t = pending.shift();
        q.push(t[0]);
        t[0]();
    }
}

var tid = 0;
function runThread(main, arg, done)
{
    var thread = function()
    {
        // pass parameters as yield result
        var pass = Array.prototype.slice.call(arguments, 0);
        try
        {
            v = thread.gen.next(pass);
        }
        catch (e)
        {
            v = { done: 1 };
        }
        if (v.done)
        {
            thread._done = true;
            finishq();
        }
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
            setTimeout(thread, 1);
        }
        else
        {
            pending.push([ thread, count ]);
        }
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
