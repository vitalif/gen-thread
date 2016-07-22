// Yet Another Hack to fight node.js callback hell: generator-based coroutines
// Distinctive features:
// - simple to use: does not require promisification of existing callback-based code
// - safely checks control flow

module.exports.run = runThread;
module.exports.runParallel = runParallel;

var current;

module.exports.unsafe = function()
{
    return current;
};

module.exports.callback = module.exports.cb = function()
{
    return threadCallback.call(current);
};

module.exports.errorfirst = module.exports.ef = function()
{
    return errorFirst.call(current);
};

module.exports.throttle = function(count)
{
    return throttleThread.call(current, count);
};

function runThread(generator, onsuccess, onerror)
{
    var thread = function() { continueThread.apply(thread, arguments) };
    thread._gen = generator.next ? generator : generator();
    thread._finishThrottleQueue = finishThrottleQueue.bind(thread);
    thread._onsuccess = onsuccess;
    thread._onerror = onerror;
    thread();
    return thread;
}

function continueThread()
{
    // pass parameters as yield result
    callGen(this, 'next', Array.prototype.slice.call(arguments, 0));
}

function callGen(thread, method, arg)
{
    var v;
    current = thread;
    try
    {
        v = thread._gen[method](arg);
    }
    catch (e)
    {
        v = { error: e };
    }
    current = null;
    if (v.done || v.error)
    {
        // generator finished
        thread._done = true;
        process.nextTick(thread._finishThrottleQueue);
    }
    if (v.error)
    {
        if (thread._onerror)
            thread._onerror(v.error);
        else
            throw v.error;
    }
    else if (v.done && thread._onsuccess)
        thread._onsuccess(v.value);
    else if (typeof v.value == 'object' && v.value.then)
    {
        // check if v.value is a Promise
        var cb = threadCallback.call(current);
        v.value.then(cb, function(error)
        {
            callGen(thread, 'throw', error);
        });
    }
}

function threadCallback()
{
    var thread = this;
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
        return callGen(thread, 'next', Array.prototype.slice.call(arguments, 0));
    };
    fn._stack = new Error().stack;
    thread._current = fn;
    return fn;
}

function errorFirst()
{
    var thread = this;
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
        if (arguments[0])
            return callGen(thread, 'throw', arguments[0]);
        return callGen(thread, 'next', Array.prototype.slice.call(arguments, 1));
    };
    fn._stack = new Error().stack;
    thread._current = fn;
    return fn;
}

function throttleThread(count)
{
    if (!this.throttleData)
        this.throttleData = this._gen.__proto__._genThreadThrottle = this._gen.__proto__._genThreadThrottle || { queue: [], pending: [] };
    this._finishThrottleQueue();
    if (this.throttleData.queue.length < count)
    {
        this.throttleData.queue.push(this);
        process.nextTick(threadCallback.call(this));
    }
    else
        this.throttleData.pending.push([ this, threadCallback.call(this), count ]);
}

function finishThrottleQueue()
{
    if (!this.throttleData)
        return;
    for (var i = 0; i < this.throttleData.queue.length; i++)
    {
        if (this.throttleData.queue[i]._done)
        {
            this.throttleData.queue.splice(i, 1);
            i--;
        }
    }
    while (this.throttleData.pending.length > 0 && this.throttleData.queue.length < this.throttleData.pending[0][2])
    {
        var t = this.throttleData.pending.shift();
        this.throttleData.queue.push(t[0]);
        process.nextTick(t[1]);
    }
}

function runParallel(threads, done)
{
    var results = [];
    var errors = [];
    var resultCount = 0;
    var allDone = function(i, result, error)
    {
        if (!results[i] && !errors[i])
        {
            if (error)
                errors[i] = error;
            else
                results[i] = result;
            resultCount++;
            if (resultCount == threads.length)
                done(results, errors);
        }
    };
    threads.map((t, i) => runThread(t, function(result) { allDone(i, result); }, function(error) { allDone(i, null, error); }));
}
