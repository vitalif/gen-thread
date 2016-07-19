// Yet Another Hack to fight node.js callback hell: generator-based coroutines

module.exports.run = runThread;
module.exports.runParallel = runParallel;

function runThread(main, arg, done)
{
    var thread = function() { continueThread.apply(thread) };
    thread._gens = [ main(thread, arg) ];
    thread.throttle = throttleThread;
    thread.cb = threadCallback.bind(thread);
    thread._finishThrottleQueue = finishThrottleQueue.bind(thread);
    thread._finishCallback = done;
    thread();
    return thread;
}

function continueThread()
{
    // pass parameters as yield result
    var pass = Array.prototype.slice.call(arguments, 0);
    var v;
    try
    {
        v = this._gens[0].next(pass);
    }
    catch (e)
    {
        v = { done: 1, error: e };
    }
    if (v.done)
    {
        // generator finished
        this._gens.shift();
        if (this._gens.length)
        {
            // return to previous generator
            this(v.value);
            return;
        }
    }
    if (typeof v.value == 'object' &&
        v.value.constructor.constructor == this._gens[0].constructor.constructor)
    {
        // another generator instance returned - add it to stack and call
        this._gens.unshift(v.value);
        this();
        return;
    }
    if (!this._gens.length)
    {
        this._done = true;
        process.nextTick(this._finishThrottleQueue);
    }
    if (v.error)
        throw v.error;
    if (!this._gens.length && this._finishCallback)
        this._finishCallback(v.value);
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
        return thread.apply(thread, arguments);
    };
    fn._stack = new Error().stack;
    thread._current = fn;
    return fn;
}

function throttleThread(count)
{
    if (!this.throttleData)
        this.throttleData = this._gens[0].__proto__._genThreadThrottle = this._gens[0].__proto__._genThreadThrottle || { queue: [], pending: [] };
    this._finishThrottleQueue();
    if (this.throttleData.queue.length < count)
    {
        this.throttleData.queue.push(this);
        process.nextTick(this.cb());
    }
    else
        this.throttleData.pending.push([ this, this.cb(), count ]);
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
