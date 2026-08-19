'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for reading/writing to localStorage with SSR support.
 * Returns the stored value, a setter function, and a hydration flag.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options?: { expiryDays?: number }
): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const [isHydrated, setIsHydrated] = useState(false);
  
  // Initialize with a function to read from localStorage
  const [storedValue, setStoredValue] = useState<T>(() => {
    // During SSR, always return initial value
    if (typeof window === 'undefined') {
      return initialValue;
    }
    
    try {
      const item = window.localStorage.getItem(key);
      if (!item) return initialValue;
      
      const parsed = JSON.parse(item);
      
      // Check for expiry if expiryDays is set
      if (options?.expiryDays && parsed._expiry) {
        if (Date.now() > parsed._expiry) {
          window.localStorage.removeItem(key);
          return initialValue;
        }
        return parsed.value ?? initialValue;
      }
      
      return parsed.value !== undefined ? parsed.value : parsed;
    } catch {
      return initialValue;
    }
  });

  // Mark as hydrated after mount
  useEffect(() => {
    // Deferred a tick: hydration status is stable for the life of the page
    // load, so resolving one macrotask after mount avoids a cascading
    // synchronous re-render while keeping the SSR/first-render markup
    // (isHydrated=false) hydration-safe.
    const arm = setTimeout(() => setIsHydrated(true), 0);
    return () => clearTimeout(arm);
  }, []);

  // Destructured so the callback closes over exactly the primitive it
  // depends on — closing over the `options` object while listing
  // `options?.expiryDays` in deps defeats memoization analysis
  // (react-hooks/preserve-manual-memoization).
  const expiryDays = options?.expiryDays;

  // Stable setValue function that doesn't depend on storedValue
  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue(prev => {
      const valueToStore = value instanceof Function ? value(prev) : value;

      // Save to localStorage
      try {
        const storageValue = expiryDays
          ? {
              value: valueToStore,
              _expiry: Date.now() + expiryDays * 24 * 60 * 60 * 1000,
            }
          : { value: valueToStore };

        window.localStorage.setItem(key, JSON.stringify(storageValue));
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }

      return valueToStore;
    });
  }, [key, expiryDays]);

  return [storedValue, setValue, isHydrated];
}
