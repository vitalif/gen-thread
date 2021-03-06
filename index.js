// Yet Another Hack to fight node.js callback hell: generator-based coroutines
// Distinctive features:
// - simple to use:
//   - does not require promisification of existing callback-based code
//   - does not require async/await
// - safely checks control flow and reports exceptions
// - also supports promises (like await)

module.exports.run = runThread;
module.exports.runParallel = runParallel;

var current;

module.exports.unsafe = function()
{
    return current;
};

module.exports.p = function(p)
{
    p._stack = new Error().stack;
    return p;
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
    var thread = function()
    {
        thread._current = null;
        // pass parameters as yield result
        callGen(thread, 'next', Array.prototype.slice.call(arguments, 0));
    };
    thread._gen = generator.next ? generator : generator();
    thread._finishThrottleQueue = finishThrottleQueue.bind(thread);
    thread._onsuccess = onsuccess;
    thread._onerror = onerror;
    thread._running = false;
    callGen(thread, 'next', []);
    return thread;
}

function getStack(fn)
{
    return fn._stack.replace(/Error[\s\S]*at.*(exports\.(cb|ef|errorfirst|p\s)|Function\.(errorFirst|threadCallback)).*/, '');
}

function callGen(thread, method, arg)
{
    if (thread._running)
    {
        // callback called while generator is already running
        thread._result = [ method, arg ];
        return;
    }
    var v;
    var prev = current;
    thread._running = true;
    current = thread;
    try
    {
        while (1)
        {
            v = thread._gen[method](arg);
            if (!v.done && thread._result)
            {
                method = thread._result[0];
                arg = thread._result[1];
                thread._result = null;
            }
            else
                break;
        }
    }
    catch (e)
    {
        v = { error: e };
    }
    thread._running = false;
    current = prev;
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
    else if (typeof v.value == 'object' && v.value.then && !thread._current)
    {
        // check if v.value is a Promise
        // (but not if an explicit .then(gen.cb()) callback is already set by caller)
        v.value.then(function(value)
        {
            // use process.nextTick so Promise does not intercept our exceptions
            process.nextTick(function() { callGen(thread, 'next', value); });
        }, function(e)
        {
            if (v.value._stack)
            {
                // report stack trace captured with `yield gen.p(promise)`
                var m = /^([\s\S]*?)((\n\s*at.*)*)$/.exec(e.stack);
                if (m)
                    e.stack = m[1]+getStack(v.value)+'\n-- async error thrown at:'+m[2];
            }
            process.nextTick(function() { callGen(thread, 'throw', e); });
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
                getStack(thread._current)+
                '\nmust be called to resume thread, but this one is called instead:'+
                getStack(fn)+'\n--'
            );
        }
        thread._current = null;
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
                getStack(thread._current)+
                '\nmust be called to resume thread, but this one is called instead:'+
                getStack(fn)+'\n--'
            );
        }
        thread._current = null;
        if (arguments[0])
        {
            var e = arguments[0];
            var m = /^([\s\S]*?)((\n\s*at.*)*)$/.exec(e.stack);
            if (m)
                e.stack = m[1]+getStack(fn)+'\n-- async error thrown at:'+m[2];
            return callGen(thread, 'throw', e);
        }
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
