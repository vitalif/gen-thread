module.exports.run = runThread;
module.exports.runParallel = runParallel;

function runThread(main, arg, done)
{
    var thread = function()
    {
        // pass parameters as yield result
        var pass = Array.prototype.slice.call(arguments, 0);
        var v = thread.gen.next(pass);
        if (v.done && done)
            done(v.value);
    };
    thread.gen = main(thread, arg);
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
