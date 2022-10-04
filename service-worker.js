(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var runtime = (function (exports) {
  "use strict";

  var Op = Object.prototype;
  var hasOwn = Op.hasOwnProperty;
  var undefined; // More compressible than void 0.
  var $Symbol = typeof Symbol === "function" ? Symbol : {};
  var iteratorSymbol = $Symbol.iterator || "@@iterator";
  var asyncIteratorSymbol = $Symbol.asyncIterator || "@@asyncIterator";
  var toStringTagSymbol = $Symbol.toStringTag || "@@toStringTag";

  function define(obj, key, value) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
    return obj[key];
  }
  try {
    // IE 8 has a broken Object.defineProperty that only works on DOM objects.
    define({}, "");
  } catch (err) {
    define = function(obj, key, value) {
      return obj[key] = value;
    };
  }

  function wrap(innerFn, outerFn, self, tryLocsList) {
    // If outerFn provided and outerFn.prototype is a Generator, then outerFn.prototype instanceof Generator.
    var protoGenerator = outerFn && outerFn.prototype instanceof Generator ? outerFn : Generator;
    var generator = Object.create(protoGenerator.prototype);
    var context = new Context(tryLocsList || []);

    // The ._invoke method unifies the implementations of the .next,
    // .throw, and .return methods.
    generator._invoke = makeInvokeMethod(innerFn, self, context);

    return generator;
  }
  exports.wrap = wrap;

  // Try/catch helper to minimize deoptimizations. Returns a completion
  // record like context.tryEntries[i].completion. This interface could
  // have been (and was previously) designed to take a closure to be
  // invoked without arguments, but in all the cases we care about we
  // already have an existing method we want to call, so there's no need
  // to create a new function object. We can even get away with assuming
  // the method takes exactly one argument, since that happens to be true
  // in every case, so we don't have to touch the arguments object. The
  // only additional allocation required is the completion record, which
  // has a stable shape and so hopefully should be cheap to allocate.
  function tryCatch(fn, obj, arg) {
    try {
      return { type: "normal", arg: fn.call(obj, arg) };
    } catch (err) {
      return { type: "throw", arg: err };
    }
  }

  var GenStateSuspendedStart = "suspendedStart";
  var GenStateSuspendedYield = "suspendedYield";
  var GenStateExecuting = "executing";
  var GenStateCompleted = "completed";

  // Returning this object from the innerFn has the same effect as
  // breaking out of the dispatch switch statement.
  var ContinueSentinel = {};

  // Dummy constructor functions that we use as the .constructor and
  // .constructor.prototype properties for functions that return Generator
  // objects. For full spec compliance, you may wish to configure your
  // minifier not to mangle the names of these two functions.
  function Generator() {}
  function GeneratorFunction() {}
  function GeneratorFunctionPrototype() {}

  // This is a polyfill for %IteratorPrototype% for environments that
  // don't natively support it.
  var IteratorPrototype = {};
  define(IteratorPrototype, iteratorSymbol, function () {
    return this;
  });

  var getProto = Object.getPrototypeOf;
  var NativeIteratorPrototype = getProto && getProto(getProto(values([])));
  if (NativeIteratorPrototype &&
      NativeIteratorPrototype !== Op &&
      hasOwn.call(NativeIteratorPrototype, iteratorSymbol)) {
    // This environment has a native %IteratorPrototype%; use it instead
    // of the polyfill.
    IteratorPrototype = NativeIteratorPrototype;
  }

  var Gp = GeneratorFunctionPrototype.prototype =
    Generator.prototype = Object.create(IteratorPrototype);
  GeneratorFunction.prototype = GeneratorFunctionPrototype;
  define(Gp, "constructor", GeneratorFunctionPrototype);
  define(GeneratorFunctionPrototype, "constructor", GeneratorFunction);
  GeneratorFunction.displayName = define(
    GeneratorFunctionPrototype,
    toStringTagSymbol,
    "GeneratorFunction"
  );

  // Helper for defining the .next, .throw, and .return methods of the
  // Iterator interface in terms of a single ._invoke method.
  function defineIteratorMethods(prototype) {
    ["next", "throw", "return"].forEach(function(method) {
      define(prototype, method, function(arg) {
        return this._invoke(method, arg);
      });
    });
  }

  exports.isGeneratorFunction = function(genFun) {
    var ctor = typeof genFun === "function" && genFun.constructor;
    return ctor
      ? ctor === GeneratorFunction ||
        // For the native GeneratorFunction constructor, the best we can
        // do is to check its .name property.
        (ctor.displayName || ctor.name) === "GeneratorFunction"
      : false;
  };

  exports.mark = function(genFun) {
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
    } else {
      genFun.__proto__ = GeneratorFunctionPrototype;
      define(genFun, toStringTagSymbol, "GeneratorFunction");
    }
    genFun.prototype = Object.create(Gp);
    return genFun;
  };

  // Within the body of any async function, `await x` is transformed to
  // `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
  // `hasOwn.call(value, "__await")` to determine if the yielded value is
  // meant to be awaited.
  exports.awrap = function(arg) {
    return { __await: arg };
  };

  function AsyncIterator(generator, PromiseImpl) {
    function invoke(method, arg, resolve, reject) {
      var record = tryCatch(generator[method], generator, arg);
      if (record.type === "throw") {
        reject(record.arg);
      } else {
        var result = record.arg;
        var value = result.value;
        if (value &&
            typeof value === "object" &&
            hasOwn.call(value, "__await")) {
          return PromiseImpl.resolve(value.__await).then(function(value) {
            invoke("next", value, resolve, reject);
          }, function(err) {
            invoke("throw", err, resolve, reject);
          });
        }

        return PromiseImpl.resolve(value).then(function(unwrapped) {
          // When a yielded Promise is resolved, its final value becomes
          // the .value of the Promise<{value,done}> result for the
          // current iteration.
          result.value = unwrapped;
          resolve(result);
        }, function(error) {
          // If a rejected Promise was yielded, throw the rejection back
          // into the async generator function so it can be handled there.
          return invoke("throw", error, resolve, reject);
        });
      }
    }

    var previousPromise;

    function enqueue(method, arg) {
      function callInvokeWithMethodAndArg() {
        return new PromiseImpl(function(resolve, reject) {
          invoke(method, arg, resolve, reject);
        });
      }

      return previousPromise =
        // If enqueue has been called before, then we want to wait until
        // all previous Promises have been resolved before calling invoke,
        // so that results are always delivered in the correct order. If
        // enqueue has not been called before, then it is important to
        // call invoke immediately, without waiting on a callback to fire,
        // so that the async generator function has the opportunity to do
        // any necessary setup in a predictable way. This predictability
        // is why the Promise constructor synchronously invokes its
        // executor callback, and why async functions synchronously
        // execute code before the first await. Since we implement simple
        // async functions in terms of async generators, it is especially
        // important to get this right, even though it requires care.
        previousPromise ? previousPromise.then(
          callInvokeWithMethodAndArg,
          // Avoid propagating failures to Promises returned by later
          // invocations of the iterator.
          callInvokeWithMethodAndArg
        ) : callInvokeWithMethodAndArg();
    }

    // Define the unified helper method that is used to implement .next,
    // .throw, and .return (see defineIteratorMethods).
    this._invoke = enqueue;
  }

  defineIteratorMethods(AsyncIterator.prototype);
  define(AsyncIterator.prototype, asyncIteratorSymbol, function () {
    return this;
  });
  exports.AsyncIterator = AsyncIterator;

  // Note that simple async functions are implemented on top of
  // AsyncIterator objects; they just return a Promise for the value of
  // the final result produced by the iterator.
  exports.async = function(innerFn, outerFn, self, tryLocsList, PromiseImpl) {
    if (PromiseImpl === void 0) PromiseImpl = Promise;

    var iter = new AsyncIterator(
      wrap(innerFn, outerFn, self, tryLocsList),
      PromiseImpl
    );

    return exports.isGeneratorFunction(outerFn)
      ? iter // If outerFn is a generator, return the full iterator.
      : iter.next().then(function(result) {
          return result.done ? result.value : iter.next();
        });
  };

  function makeInvokeMethod(innerFn, self, context) {
    var state = GenStateSuspendedStart;

    return function invoke(method, arg) {
      if (state === GenStateExecuting) {
        throw new Error("Generator is already running");
      }

      if (state === GenStateCompleted) {
        if (method === "throw") {
          throw arg;
        }

        // Be forgiving, per 25.3.3.3.3 of the spec:
        // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
        return doneResult();
      }

      context.method = method;
      context.arg = arg;

      while (true) {
        var delegate = context.delegate;
        if (delegate) {
          var delegateResult = maybeInvokeDelegate(delegate, context);
          if (delegateResult) {
            if (delegateResult === ContinueSentinel) continue;
            return delegateResult;
          }
        }

        if (context.method === "next") {
          // Setting context._sent for legacy support of Babel's
          // function.sent implementation.
          context.sent = context._sent = context.arg;

        } else if (context.method === "throw") {
          if (state === GenStateSuspendedStart) {
            state = GenStateCompleted;
            throw context.arg;
          }

          context.dispatchException(context.arg);

        } else if (context.method === "return") {
          context.abrupt("return", context.arg);
        }

        state = GenStateExecuting;

        var record = tryCatch(innerFn, self, context);
        if (record.type === "normal") {
          // If an exception is thrown from innerFn, we leave state ===
          // GenStateExecuting and loop back for another invocation.
          state = context.done
            ? GenStateCompleted
            : GenStateSuspendedYield;

          if (record.arg === ContinueSentinel) {
            continue;
          }

          return {
            value: record.arg,
            done: context.done
          };

        } else if (record.type === "throw") {
          state = GenStateCompleted;
          // Dispatch the exception by looping back around to the
          // context.dispatchException(context.arg) call above.
          context.method = "throw";
          context.arg = record.arg;
        }
      }
    };
  }

  // Call delegate.iterator[context.method](context.arg) and handle the
  // result, either by returning a { value, done } result from the
  // delegate iterator, or by modifying context.method and context.arg,
  // setting context.delegate to null, and returning the ContinueSentinel.
  function maybeInvokeDelegate(delegate, context) {
    var method = delegate.iterator[context.method];
    if (method === undefined) {
      // A .throw or .return when the delegate iterator has no .throw
      // method always terminates the yield* loop.
      context.delegate = null;

      if (context.method === "throw") {
        // Note: ["return"] must be used for ES3 parsing compatibility.
        if (delegate.iterator["return"]) {
          // If the delegate iterator has a return method, give it a
          // chance to clean up.
          context.method = "return";
          context.arg = undefined;
          maybeInvokeDelegate(delegate, context);

          if (context.method === "throw") {
            // If maybeInvokeDelegate(context) changed context.method from
            // "return" to "throw", let that override the TypeError below.
            return ContinueSentinel;
          }
        }

        context.method = "throw";
        context.arg = new TypeError(
          "The iterator does not provide a 'throw' method");
      }

      return ContinueSentinel;
    }

    var record = tryCatch(method, delegate.iterator, context.arg);

    if (record.type === "throw") {
      context.method = "throw";
      context.arg = record.arg;
      context.delegate = null;
      return ContinueSentinel;
    }

    var info = record.arg;

    if (! info) {
      context.method = "throw";
      context.arg = new TypeError("iterator result is not an object");
      context.delegate = null;
      return ContinueSentinel;
    }

    if (info.done) {
      // Assign the result of the finished delegate to the temporary
      // variable specified by delegate.resultName (see delegateYield).
      context[delegate.resultName] = info.value;

      // Resume execution at the desired location (see delegateYield).
      context.next = delegate.nextLoc;

      // If context.method was "throw" but the delegate handled the
      // exception, let the outer generator proceed normally. If
      // context.method was "next", forget context.arg since it has been
      // "consumed" by the delegate iterator. If context.method was
      // "return", allow the original .return call to continue in the
      // outer generator.
      if (context.method !== "return") {
        context.method = "next";
        context.arg = undefined;
      }

    } else {
      // Re-yield the result returned by the delegate method.
      return info;
    }

    // The delegate iterator is finished, so forget it and continue with
    // the outer generator.
    context.delegate = null;
    return ContinueSentinel;
  }

  // Define Generator.prototype.{next,throw,return} in terms of the
  // unified ._invoke helper method.
  defineIteratorMethods(Gp);

  define(Gp, toStringTagSymbol, "Generator");

  // A Generator should always return itself as the iterator object when the
  // @@iterator function is called on it. Some browsers' implementations of the
  // iterator prototype chain incorrectly implement this, causing the Generator
  // object to not be returned from this call. This ensures that doesn't happen.
  // See https://github.com/facebook/regenerator/issues/274 for more details.
  define(Gp, iteratorSymbol, function() {
    return this;
  });

  define(Gp, "toString", function() {
    return "[object Generator]";
  });

  function pushTryEntry(locs) {
    var entry = { tryLoc: locs[0] };

    if (1 in locs) {
      entry.catchLoc = locs[1];
    }

    if (2 in locs) {
      entry.finallyLoc = locs[2];
      entry.afterLoc = locs[3];
    }

    this.tryEntries.push(entry);
  }

  function resetTryEntry(entry) {
    var record = entry.completion || {};
    record.type = "normal";
    delete record.arg;
    entry.completion = record;
  }

  function Context(tryLocsList) {
    // The root entry object (effectively a try statement without a catch
    // or a finally block) gives us a place to store values thrown from
    // locations where there is no enclosing try statement.
    this.tryEntries = [{ tryLoc: "root" }];
    tryLocsList.forEach(pushTryEntry, this);
    this.reset(true);
  }

  exports.keys = function(object) {
    var keys = [];
    for (var key in object) {
      keys.push(key);
    }
    keys.reverse();

    // Rather than returning an object with a next method, we keep
    // things simple and return the next function itself.
    return function next() {
      while (keys.length) {
        var key = keys.pop();
        if (key in object) {
          next.value = key;
          next.done = false;
          return next;
        }
      }

      // To avoid creating an additional object, we just hang the .value
      // and .done properties off the next function object itself. This
      // also ensures that the minifier will not anonymize the function.
      next.done = true;
      return next;
    };
  };

  function values(iterable) {
    if (iterable) {
      var iteratorMethod = iterable[iteratorSymbol];
      if (iteratorMethod) {
        return iteratorMethod.call(iterable);
      }

      if (typeof iterable.next === "function") {
        return iterable;
      }

      if (!isNaN(iterable.length)) {
        var i = -1, next = function next() {
          while (++i < iterable.length) {
            if (hasOwn.call(iterable, i)) {
              next.value = iterable[i];
              next.done = false;
              return next;
            }
          }

          next.value = undefined;
          next.done = true;

          return next;
        };

        return next.next = next;
      }
    }

    // Return an iterator with no values.
    return { next: doneResult };
  }
  exports.values = values;

  function doneResult() {
    return { value: undefined, done: true };
  }

  Context.prototype = {
    constructor: Context,

    reset: function(skipTempReset) {
      this.prev = 0;
      this.next = 0;
      // Resetting context._sent for legacy support of Babel's
      // function.sent implementation.
      this.sent = this._sent = undefined;
      this.done = false;
      this.delegate = null;

      this.method = "next";
      this.arg = undefined;

      this.tryEntries.forEach(resetTryEntry);

      if (!skipTempReset) {
        for (var name in this) {
          // Not sure about the optimal order of these conditions:
          if (name.charAt(0) === "t" &&
              hasOwn.call(this, name) &&
              !isNaN(+name.slice(1))) {
            this[name] = undefined;
          }
        }
      }
    },

    stop: function() {
      this.done = true;

      var rootEntry = this.tryEntries[0];
      var rootRecord = rootEntry.completion;
      if (rootRecord.type === "throw") {
        throw rootRecord.arg;
      }

      return this.rval;
    },

    dispatchException: function(exception) {
      if (this.done) {
        throw exception;
      }

      var context = this;
      function handle(loc, caught) {
        record.type = "throw";
        record.arg = exception;
        context.next = loc;

        if (caught) {
          // If the dispatched exception was caught by a catch block,
          // then let that catch block handle the exception normally.
          context.method = "next";
          context.arg = undefined;
        }

        return !! caught;
      }

      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        var record = entry.completion;

        if (entry.tryLoc === "root") {
          // Exception thrown outside of any try block that could handle
          // it, so set the completion value of the entire function to
          // throw the exception.
          return handle("end");
        }

        if (entry.tryLoc <= this.prev) {
          var hasCatch = hasOwn.call(entry, "catchLoc");
          var hasFinally = hasOwn.call(entry, "finallyLoc");

          if (hasCatch && hasFinally) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            } else if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else if (hasCatch) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            }

          } else if (hasFinally) {
            if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else {
            throw new Error("try statement without catch or finally");
          }
        }
      }
    },

    abrupt: function(type, arg) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc <= this.prev &&
            hasOwn.call(entry, "finallyLoc") &&
            this.prev < entry.finallyLoc) {
          var finallyEntry = entry;
          break;
        }
      }

      if (finallyEntry &&
          (type === "break" ||
           type === "continue") &&
          finallyEntry.tryLoc <= arg &&
          arg <= finallyEntry.finallyLoc) {
        // Ignore the finally entry if control is not jumping to a
        // location outside the try/catch block.
        finallyEntry = null;
      }

      var record = finallyEntry ? finallyEntry.completion : {};
      record.type = type;
      record.arg = arg;

      if (finallyEntry) {
        this.method = "next";
        this.next = finallyEntry.finallyLoc;
        return ContinueSentinel;
      }

      return this.complete(record);
    },

    complete: function(record, afterLoc) {
      if (record.type === "throw") {
        throw record.arg;
      }

      if (record.type === "break" ||
          record.type === "continue") {
        this.next = record.arg;
      } else if (record.type === "return") {
        this.rval = this.arg = record.arg;
        this.method = "return";
        this.next = "end";
      } else if (record.type === "normal" && afterLoc) {
        this.next = afterLoc;
      }

      return ContinueSentinel;
    },

    finish: function(finallyLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.finallyLoc === finallyLoc) {
          this.complete(entry.completion, entry.afterLoc);
          resetTryEntry(entry);
          return ContinueSentinel;
        }
      }
    },

    "catch": function(tryLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc === tryLoc) {
          var record = entry.completion;
          if (record.type === "throw") {
            var thrown = record.arg;
            resetTryEntry(entry);
          }
          return thrown;
        }
      }

      // The context.catch method must only be called with a location
      // argument that corresponds to a known catch block.
      throw new Error("illegal catch attempt");
    },

    delegateYield: function(iterable, resultName, nextLoc) {
      this.delegate = {
        iterator: values(iterable),
        resultName: resultName,
        nextLoc: nextLoc
      };

      if (this.method === "next") {
        // Deliberately forget the last sent value so that we don't
        // accidentally pass it on to the delegate.
        this.arg = undefined;
      }

      return ContinueSentinel;
    }
  };

  // Regardless of whether this script is executing as a CommonJS module
  // or not, return the runtime object so that we can declare the variable
  // regeneratorRuntime in the outer scope, which allows this module to be
  // injected easily by `bin/regenerator --include-runtime script.js`.
  return exports;

}(
  // If this script is executing as a CommonJS module, use module.exports
  // as the regeneratorRuntime namespace. Otherwise create a new empty
  // object. Either way, the resulting object will be used to initialize
  // the regeneratorRuntime variable at the top of this file.
  typeof module === "object" ? module.exports : {}
));

try {
  regeneratorRuntime = runtime;
} catch (accidentalStrictMode) {
  // This module should not be running in strict mode, so the above
  // assignment should always work unless something is misconfigured. Just
  // in case runtime.js accidentally runs in strict mode, in modern engines
  // we can explicitly access globalThis. In older engines we can escape
  // strict mode using a global Function call. This could conceivably fail
  // if a Content Security Policy forbids using Function, but in that case
  // the proper solution is to fix the accidental strict mode problem. If
  // you've misconfigured your bundler to force strict mode and applied a
  // CSP to forbid Function, and you're not willing to fix either of those
  // problems, please detail your unique predicament in a GitHub issue.
  if (typeof globalThis === "object") {
    globalThis.regeneratorRuntime = runtime;
  } else {
    Function("r", "regeneratorRuntime = r")(runtime);
  }
}

},{}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Service worker
 * @module
 */
/// <reference lib="WebWorker" />
require("regenerator-runtime");
const sw = self;
const CACHE = 'cache-ae9e4c0';
/**
 * IndexedDB singleton wrapper used to store persistent information with an predefined {@link Schema}
 */
const idb = (() => {
    let dbInstance;
    function getDB() {
        if (!dbInstance) {
            dbInstance = new Promise((resolve, reject) => {
                const openreq = indexedDB.open('nb-keyval', 1);
                openreq.onerror = () => {
                    reject(openreq.error);
                };
                openreq.onupgradeneeded = () => {
                    // first time setup
                    openreq.result.createObjectStore('meta');
                };
                openreq.onsuccess = () => {
                    resolve(openreq.result);
                };
            });
        }
        return dbInstance;
    }
    async function withStore(type, callback) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('meta', type);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            callback(transaction.objectStore('meta'));
        });
    }
    return {
        async get(key) {
            let request;
            await withStore('readonly', store => {
                request = store.get(key);
            });
            return request?.result;
        },
        set(data) {
            return withStore('readwrite', store => {
                store.put(data.value, data.key);
            });
        },
        delete(key) {
            return withStore('readwrite', store => {
                store.delete(key);
            });
        },
    };
})();
function handleInstall(e) {
    console.log('[install] Kicking off service worker registration');
    e.waitUntil(cache('install').then(() => sw.skipWaiting()));
}
function handleActivate(e) {
    console.log('[activate] Activating service worker');
    sw.clients
        .matchAll({
        includeUncontrolled: true,
    })
        .then(clientList => {
        const urls = clientList.map(client => client.url);
        console.log('[activate] Matching clients:', urls.join(', '));
    });
    e.waitUntil(deleteOldCache('activate')
        .then(() => {
        console.log('[activate] Claiming clients for version', CACHE);
        return sw.clients.claim();
    })
        .then(() => idb.set({ key: 'activatedAt', value: new Date().toISOString() })));
}
function handleFetch(e) {
    e.respondWith(caches.open(CACHE).then(async (cache) => {
        const ignoreCache = (await idb.get('ignoreCache')) || false;
        return cache.match(e.request).then(matching => {
            if (matching && !ignoreCache) {
                console.log('[fetch] Serving file from cache: ', e.request.url);
                return matching;
            }
            console.log('[fetch] Fetching file: ', e.request.url);
            return fetch(e.request);
        });
    }));
}
const success = (data) => ({
    success: true,
    data: data,
});
const error = (error) => ({
    success: false,
    error: new Error(error),
});
// try catch could be done on the callers side
const resolvers = {
    getMetadata: async () => {
        try {
            return success({
                activatedAt: await idb.get('activatedAt'),
                cacheDeletedAt: await idb.get('cacheDeletedAt'),
                cacheUpdatedAt: await idb.get('cacheUpdatedAt'),
                oldCacheDeletedAt: await idb.get('oldCacheDeletedAt'),
                ignoreCache: (await idb.get('ignoreCache')) || false,
                cacheExists: await caches.has(CACHE),
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    getOldCacheDeletedAt: async () => {
        try {
            return success({
                oldCacheDeletedAt: await idb.get('oldCacheDeletedAt'),
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    getCacheDeletedAt: async () => {
        try {
            return success({
                cacheDeletedAt: await idb.get('cacheDeletedAt'),
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    setIgnoreCache: async (e) => {
        try {
            await idb.set({ key: 'ignoreCache', value: e.payload.value });
            return success({
                ignoreCache: e.payload.value,
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    getIgnoreCache: async () => {
        try {
            return success({
                ignoreCache: (await idb.get('ignoreCache')) || false,
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    getActivatedAt: async () => {
        try {
            return success({
                activatedAt: await idb.get('activatedAt'),
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    deleteOldCache: async () => {
        try {
            await deleteOldCache('deleteOldCache');
            return success({
                oldCacheDeletedAt: await idb.get('oldCacheDeletedAt'),
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    deleteCache: async () => {
        try {
            if (!(await caches.delete(CACHE))) {
                throw Error('Cache does not exist.');
            }
            await setCacheDeletedAt();
            return success({
                cacheDeletedAt: await idb.get('cacheDeletedAt'),
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    updateCache: async () => {
        try {
            if (await caches.delete(CACHE)) {
                await setCacheDeletedAt();
            }
            await cache('updateCache');
            return success({
                cacheDeletedAt: await idb.get('cacheDeletedAt'),
                cacheUpdatedAt: await idb.get('cacheUpdatedAt'),
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    getCacheUpdatedAt: async () => {
        try {
            return success({
                cacheUpdatedAt: await idb.get('cacheUpdatedAt'),
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
    getCacheExists: async () => {
        try {
            return success({
                cacheExists: await caches.has(CACHE),
            });
        }
        catch (e) {
            return error(e.message);
        }
    },
};
async function handleMessage(e) {
    console.log('[message router] Recieved message:', e.data.message);
    // check event.origin for added security
    if (!e.data?.message) {
        postMessage({ success: false, error: 'Message not provided.' });
        return;
    }
    if (resolvers.hasOwnProperty(e.data.message)) {
        const data = await resolvers[e.data.message](e.data);
        postMessage(data);
        return;
    }
    postMessage({ success: false, error: 'Resolver does not exist.' });
    return;
}
function postMessage(data) {
    sw.clients
        .matchAll({
        includeUncontrolled: true,
    })
        .then(clientList => {
        clientList.forEach(function (client) {
            client.postMessage(data);
        });
    });
}
async function cache(context) {
    return caches
        .open(CACHE)
        .then(cache => {
        console.log('[' + context + '] Opened cache');
        return cache.addAll(["./","./about.html","./index.html","./learovy_tresky_plesky_cesky_005.html","./learovy_tresky_plesky_cesky_006.html","./learovy_tresky_plesky_cesky_007.html","./learovy_tresky_plesky_cesky_008.html","./learovy_tresky_plesky_cesky_009.html","./learovy_tresky_plesky_cesky_010.html","./learovy_tresky_plesky_cesky_011.html","./learovy_tresky_plesky_cesky_012.html","./learovy_tresky_plesky_cesky_013.html","./learovy_tresky_plesky_cesky_014.html","./learovy_tresky_plesky_cesky_015.html","./learovy_tresky_plesky_cesky_016.html","./learovy_tresky_plesky_cesky_017.html","./learovy_tresky_plesky_cesky_018.html","./learovy_tresky_plesky_cesky_019.html","./learovy_tresky_plesky_cesky_020.html","./learovy_tresky_plesky_cesky_021.html","./learovy_tresky_plesky_cesky_022.html","./learovy_tresky_plesky_cesky_023.html","./learovy_tresky_plesky_cesky_024.html","./learovy_tresky_plesky_cesky_025.html","./learovy_tresky_plesky_cesky_026.html","./learovy_tresky_plesky_cesky_027.html","./learovy_tresky_plesky_cesky_028.html","./learovy_tresky_plesky_cesky_029.html","./learovy_tresky_plesky_cesky_030.html","./learovy_tresky_plesky_cesky_031.html","./learovy_tresky_plesky_cesky_032.html","./learovy_tresky_plesky_cesky_033.html","./learovy_tresky_plesky_cesky_034.html","./learovy_tresky_plesky_cesky_035.html","./learovy_tresky_plesky_cesky_036.html","./learovy_tresky_plesky_cesky_037.html","./learovy_tresky_plesky_cesky_038.html","./learovy_tresky_plesky_cesky_039.html","./learovy_tresky_plesky_cesky_040.html","./learovy_tresky_plesky_cesky_041.html","./learovy_tresky_plesky_cesky_042.html","./learovy_tresky_plesky_cesky_043.html","./learovy_tresky_plesky_cesky_044.html","./learovy_tresky_plesky_cesky_045.html","./learovy_tresky_plesky_cesky_046.html","./learovy_tresky_plesky_cesky_047.html","./learovy_tresky_plesky_cesky_048.html","./learovy_tresky_plesky_cesky_049.html","./learovy_tresky_plesky_cesky_050.html","./learovy_tresky_plesky_cesky_051.html","./learovy_tresky_plesky_cesky_052.html","./learovy_tresky_plesky_cesky_053.html","./learovy_tresky_plesky_cesky_054.html","./learovy_tresky_plesky_cesky_055.html","./learovy_tresky_plesky_cesky_056.html","./learovy_tresky_plesky_cesky_057.html","./learovy_tresky_plesky_cesky_058.html","./learovy_tresky_plesky_cesky_059.html","./learovy_tresky_plesky_cesky_060.html","./learovy_tresky_plesky_cesky_061.html","./learovy_tresky_plesky_cesky_062.html","./learovy_tresky_plesky_cesky_063.html","./learovy_tresky_plesky_cesky_064.html","./learovy_tresky_plesky_cesky_065.html","./learovy_tresky_plesky_cesky_066.html","./learovy_tresky_plesky_cesky_067.html","./learovy_tresky_plesky_cesky_068.html","./learovy_tresky_plesky_cesky_069.html","./learovy_tresky_plesky_cesky_070.html","./learovy_tresky_plesky_cesky_071.html","./learovy_tresky_plesky_cesky_072.html","./learovy_tresky_plesky_cesky_073.html","./learovy_tresky_plesky_cesky_074.html","./learovy_tresky_plesky_cesky_075.html","./learovy_tresky_plesky_cesky_076.html","./learovy_tresky_plesky_cesky_077.html","./learovy_tresky_plesky_cesky_078.html","./learovy_tresky_plesky_cesky_079.html","./learovy_tresky_plesky_cesky_080.html","./learovy_tresky_plesky_cesky_081.html","./learovy_tresky_plesky_cesky_082.html","./learovy_tresky_plesky_cesky_083.html","./learovy_tresky_plesky_cesky_084.html","./learovy_tresky_plesky_cesky_085.html","./learovy_tresky_plesky_cesky_086.html","./learovy_tresky_plesky_cesky_087.html","./learovy_tresky_plesky_cesky_088.html","./learovy_tresky_plesky_cesky_089.html","./learovy_tresky_plesky_cesky_090.html","./learovy_tresky_plesky_cesky_091.html","./learovy_tresky_plesky_cesky_092.html","./learovy_tresky_plesky_cesky_093.html","./learovy_tresky_plesky_cesky_094.html","./learovy_tresky_plesky_cesky_095.html","./learovy_tresky_plesky_cesky_096.html","./learovy_tresky_plesky_cesky_097.html","./learovy_tresky_plesky_cesky_098.html","./learovy_tresky_plesky_cesky_099.html","./learovy_tresky_plesky_cesky_100.html","./learovy_tresky_plesky_cesky_101.html","./learovy_tresky_plesky_cesky_102.html","./learovy_tresky_plesky_cesky_103.html","./learovy_tresky_plesky_cesky_104.html","./learovy_tresky_plesky_cesky_105.html","./learovy_tresky_plesky_cesky_106.html","./learovy_tresky_plesky_cesky_107.html","./learovy_tresky_plesky_cesky_108.html","./learovy_tresky_plesky_cesky_109.html","./learovy_tresky_plesky_cesky_110.html","./learovy_tresky_plesky_cesky_111.html","./learovy_tresky_plesky_cesky_112.html","./learovy_tresky_plesky_cesky_113.html","./learovy_tresky_plesky_cesky_114.html","./learovy_tresky_plesky_cesky_115.html","./learovy_tresky_plesky_cesky_116.html","./manifest.json","./promo.html","./assets/android-chrome-144x144.png","./assets/android-chrome-192x192.png","./assets/android-chrome-256x256.png","./assets/android-chrome-36x36.png","./assets/android-chrome-384x384.png","./assets/android-chrome-48x48.png","./assets/android-chrome-512x512.png","./assets/android-chrome-72x72.png","./assets/android-chrome-96x96.png","./assets/apple-touch-icon-1024x1024.png","./assets/apple-touch-icon-114x114.png","./assets/apple-touch-icon-120x120.png","./assets/apple-touch-icon-144x144.png","./assets/apple-touch-icon-152x152.png","./assets/apple-touch-icon-167x167.png","./assets/apple-touch-icon-180x180.png","./assets/apple-touch-icon-57x57.png","./assets/apple-touch-icon-60x60.png","./assets/apple-touch-icon-72x72.png","./assets/apple-touch-icon-76x76.png","./assets/apple-touch-icon-precomposed.png","./assets/apple-touch-icon.png","./assets/cover-1200x1200.png","./assets/cover-1200x620.png","./assets/cover-1600x2560.png","./assets/cover-398x566.png","./assets/favicon-16x16.png","./assets/favicon-32x32.png","./assets/favicon-48x48.png","./assets/favicon.ico","./assets/icon.png","./assets/manifest.webmanifest","./fonts/Literata-Italic-var.woff2","./fonts/Literata-var.woff2","./fonts/LiterataTT-TextItalic.woff2","./fonts/LiterataTT-TextRegular.woff2","./fonts/LiterataTT-TextSemibold.woff2","./fonts/LiterataTT_LICENSE.txt","./fonts/SpaceGroteskVF.woff2","./fonts/SpaceGroteskVF_LICENSE.txt","./resources/007.jpg","./resources/008.jpg","./resources/009.jpg","./resources/010.jpg","./resources/011.jpg","./resources/012.jpg","./resources/013.jpg","./resources/014.jpg","./resources/015.jpg","./resources/016.jpg","./resources/017.jpg","./resources/018.jpg","./resources/019.jpg","./resources/020.jpg","./resources/021.jpg","./resources/022.jpg","./resources/023.jpg","./resources/024.jpg","./resources/025.jpg","./resources/026.jpg","./resources/027.jpg","./resources/028.jpg","./resources/029.jpg","./resources/030.jpg","./resources/031.jpg","./resources/032.jpg","./resources/033.jpg","./resources/034.jpg","./resources/035.jpg","./resources/036.jpg","./resources/037.jpg","./resources/038.jpg","./resources/039.jpg","./resources/040.jpg","./resources/041.jpg","./resources/042.jpg","./resources/043.jpg","./resources/044.jpg","./resources/045.jpg","./resources/046.jpg","./resources/047.jpg","./resources/048.jpg","./resources/049.jpg","./resources/050.jpg","./resources/051.jpg","./resources/052.jpg","./resources/053.jpg","./resources/054.jpg","./resources/055.jpg","./resources/056.jpg","./resources/057.jpg","./resources/058.jpg","./resources/059.jpg","./resources/060.jpg","./resources/061.jpg","./resources/062.jpg","./resources/063.jpg","./resources/064.jpg","./resources/065.jpg","./resources/066.jpg","./resources/067.jpg","./resources/068.jpg","./resources/069.jpg","./resources/070.jpg","./resources/071.jpg","./resources/072.jpg","./resources/073.jpg","./resources/074.jpg","./resources/075.jpg","./resources/076.jpg","./resources/077.jpg","./resources/078.jpg","./resources/079.jpg","./resources/080.jpg","./resources/081.jpg","./resources/082.jpg","./resources/083.jpg","./resources/084.jpg","./resources/085.jpg","./resources/086.jpg","./resources/087.jpg","./resources/088.jpg","./resources/089.jpg","./resources/090.jpg","./resources/091.jpg","./resources/092.jpg","./resources/093.jpg","./resources/094.jpg","./resources/095.jpg","./resources/096.jpg","./resources/097.jpg","./resources/098.jpg","./resources/099.jpg","./resources/100.jpg","./resources/101.jpg","./resources/102.jpg","./resources/103.jpg","./resources/104.jpg","./resources/105.jpg","./resources/106.jpg","./resources/107.jpg","./resources/108.jpg","./resources/109.jpg","./resources/110.jpg","./resources/111.jpg","./resources/112.jpg","./resources/113.jpg","./resources/114.jpg","./resources/115.jpg","./resources/116.jpg","./resources/117.jpg","./resources/image001.jpg","./resources/image002.jpg","./resources/obalka_learovy_tresky_plesky_cesky.jpg","./resources/upoutavka_eknihy.jpg","./scripts/bundle.js","./style/style.min.css","./template-images/circles.png"]);
    })
        .then(() => idb.set({ key: 'cacheUpdatedAt', value: new Date().toISOString() }))
        .then(() => {
        console.log('[' + context + '] All required resources have been cached;');
        if (context === 'install') {
            console.log('the Service Worker was successfully installed');
        }
    });
}
async function deleteOldCache(context) {
    return caches
        .keys()
        .then(cacheNames => Promise.all(cacheNames.map(cacheName => {
        if (cacheName !== CACHE) {
            console.log('[' + context + '] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
        }
        return null;
    })))
        .then(async () => idb.set({ key: 'oldCacheDeletedAt', value: new Date().toISOString() }));
}
async function setCacheDeletedAt() {
    await idb.set({ key: 'cacheDeletedAt', value: new Date().toISOString() });
}
sw.addEventListener('install', handleInstall);
sw.addEventListener('activate', handleActivate);
sw.addEventListener('fetch', handleFetch);
sw.addEventListener('message', handleMessage);

},{"regenerator-runtime":1}]},{},[2]);
