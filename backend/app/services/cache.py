"""
In-memory bounded cache with TTL for BreatheWise.
"""
import time
from typing import Any, Optional
from collections import OrderedDict


class InMemoryCache:
    """
    Thread-safe-compatible bounded in-memory cache with TTL (in seconds) and max size.
    Evicts least-recently-used items when capacity is reached.
    """
    def __init__(self, default_ttl_seconds: int = 900, max_entries: int = 256):
        self.default_ttl = default_ttl_seconds
        self.max_entries = max_entries
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()

    def get(self, key: str) -> Optional[Any]:
        if key not in self._store:
            return None
        expires_at, val = self._store[key]
        if time.time() > expires_at:
            # Expired
            del self._store[key]
            return None
        # Move to end (most recently used)
        self._store.move_to_end(key)
        return val

    def set(self, key: str, value: Any, ttl_seconds: Optional[int] = None) -> None:
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        expires_at = time.time() + ttl

        if key in self._store:
            del self._store[key]
        else:
            # Check capacity before inserting new key
            while len(self._store) >= self.max_entries:
                self._store.popitem(last=False)

        self._store[key] = (expires_at, value)

    def clear(self) -> None:
        self._store.clear()

    def size(self) -> int:
        now = time.time()
        expired_keys = [k for k, (exp, _) in self._store.items() if now > exp]
        for k in expired_keys:
            del self._store[k]
        return len(self._store)


# Global cache instance for air quality queries (TTL 15 mins = 900s, max 256 locations)
cache = InMemoryCache(default_ttl_seconds=900, max_entries=256)
