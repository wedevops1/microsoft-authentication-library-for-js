/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    TokenKeys,
    AccountEntity,
    IdTokenEntity,
    AccessTokenEntity,
    RefreshTokenEntity,
    AppMetadataEntity,
    ServerTelemetryEntity,
    ThrottlingEntity,
    CacheManager,
    Logger,
    ValidCacheType,
    ICrypto,
    AuthorityMetadataEntity,
    ValidCredentialType,
} from "@azure/msal-common";

import { Deserializer } from "./serializer/Deserializer";
import { Serializer } from "./serializer/Serializer";
import {
    InMemoryCache,
    JsonCache,
    CacheKVStore,
} from "./serializer/SerializerTypes";

/**
 * This class implements Storage for node, reading cache from user specified storage location or an  extension library
 * @public
 */
export class NodeStorage extends CacheManager {
    // Cache configuration, either set by user or default values.
    private logger: Logger;
    private cache: CacheKVStore = {};
    private changeEmitters: Array<Function> = [];

    constructor(logger: Logger, clientId: string, cryptoImpl: ICrypto) {
        super(clientId, cryptoImpl, logger);
        this.logger = logger;
    }

    /**
     * Queue up callbacks
     * @param func - a callback function for cache change indication
     */
    registerChangeEmitter(func: () => void): void {
        this.changeEmitters.push(func);
    }

    /**
     * Invoke the callback when cache changes
     */
    emitChange(): void {
        this.changeEmitters.forEach((func) => func.call(null));
    }

    /**
     * Converts cacheKVStore to InMemoryCache
     * @param cache - key value store
     */
    cacheToInMemoryCache(cache: CacheKVStore): InMemoryCache {
        const inMemoryCache: InMemoryCache = {
            accounts: {},
            idTokens: {},
            accessTokens: {},
            refreshTokens: {},
            appMetadata: {},
        };

        for (const key in cache) {
            if (cache[key as string] instanceof AccountEntity) {
                inMemoryCache.accounts[key] = cache[key] as AccountEntity;
            } else if (cache[key] instanceof IdTokenEntity) {
                inMemoryCache.idTokens[key] = cache[key] as IdTokenEntity;
            } else if (cache[key] instanceof AccessTokenEntity) {
                inMemoryCache.accessTokens[key] = cache[
                    key
                ] as AccessTokenEntity;
            } else if (cache[key] instanceof RefreshTokenEntity) {
                inMemoryCache.refreshTokens[key] = cache[
                    key
                ] as RefreshTokenEntity;
            } else if (cache[key] instanceof AppMetadataEntity) {
                inMemoryCache.appMetadata[key] = cache[
                    key
                ] as AppMetadataEntity;
            } else {
                continue;
            }
        }

        return inMemoryCache;
    }

    /**
     * converts inMemoryCache to CacheKVStore
     * @param inMemoryCache - kvstore map for inmemory
     */
    inMemoryCacheToCache(inMemoryCache: InMemoryCache): CacheKVStore {
        // convert in memory cache to a flat Key-Value map
        let cache = this.getCache();

        cache = {
            ...cache,
            ...inMemoryCache.accounts,
            ...inMemoryCache.idTokens,
            ...inMemoryCache.accessTokens,
            ...inMemoryCache.refreshTokens,
            ...inMemoryCache.appMetadata,
        };

        // convert in memory cache to a flat Key-Value map
        return cache;
    }

    /**
     * gets the current in memory cache for the client
     */
    getInMemoryCache(): InMemoryCache {
        this.logger.trace("Getting in-memory cache");

        // convert the cache key value store to inMemoryCache
        const inMemoryCache = this.cacheToInMemoryCache(this.getCache());
        return inMemoryCache;
    }

    /**
     * sets the current in memory cache for the client
     * @param inMemoryCache - key value map in memory
     */
    setInMemoryCache(inMemoryCache: InMemoryCache): void {
        this.logger.trace("Setting in-memory cache");

        // convert and append the inMemoryCache to cacheKVStore
        const cache = this.inMemoryCacheToCache(inMemoryCache);
        this.setCache(cache);

        this.emitChange();
    }

    /**
     * get the current cache key-value store
     */
    getCache(): CacheKVStore {
        this.logger.trace("Getting cache key-value store");
        return this.cache;
    }

    /**
     * sets the current cache (key value store)
     * @param cacheMap - key value map
     */
    setCache(cache: CacheKVStore): void {
        this.logger.trace("Setting cache key value store");
        this.cache = cache;

        // mark change in cache
        this.emitChange();
    }

    /**
     * Gets cache item with given key.
     * @param key - lookup key for the cache entry
     */
    getItem(key: string): ValidCacheType {
        this.logger.tracePii(`Item key: ${key}`);

        // read cache
        const cache = this.getCache();
        return cache[key];
    }

    /**
     * Gets cache item with given key-value
     * @param key - lookup key for the cache entry
     * @param value - value of the cache entry
     */
    setItem(key: string, value: ValidCacheType): void {
        this.logger.tracePii(`Item key: ${key}`);

        // read cache
        const cache = this.getCache();
        cache[key] = value;

        // write to cache
        this.setCache(cache);
    }

    getAccountKeys(): string[] {
        const inMemoryCache = this.getInMemoryCache();
        const accountKeys = Object.keys(inMemoryCache.accounts);

        return accountKeys;
    }

    getTokenKeys(): TokenKeys {
        const inMemoryCache = this.getInMemoryCache();
        const tokenKeys = {
            idToken: Object.keys(inMemoryCache.idTokens),
            accessToken: Object.keys(inMemoryCache.accessTokens),
            refreshToken: Object.keys(inMemoryCache.refreshTokens),
        };

        return tokenKeys;
    }

    /**
     * fetch the account entity
     * @param accountKey - lookup key to fetch cache type AccountEntity
     */
    getAccount(accountKey: string): AccountEntity | null {
        const account = this.getItem(accountKey) as AccountEntity;
        if (AccountEntity.isAccountEntity(account)) {
            return account;
        }
        return null;
    }

    /**
     * set account entity
     * @param account - cache value to be set of type AccountEntity
     */
    setAccount(account: AccountEntity): void {
        const accountKey = account.generateAccountKey();
        this.setItem(accountKey, account);
    }

    /**
     * fetch the idToken credential
     * @param idTokenKey - lookup key to fetch cache type IdTokenEntity
     */
    getIdTokenCredential(idTokenKey: string): IdTokenEntity | null {
        const idToken = this.getItem(idTokenKey) as IdTokenEntity;
        if (IdTokenEntity.isIdTokenEntity(idToken)) {
            return idToken;
        }
        return null;
    }

    /**
     * set idToken credential
     * @param idToken - cache value to be set of type IdTokenEntity
     */
    setIdTokenCredential(idToken: IdTokenEntity): void {
        const idTokenKey = idToken.generateCredentialKey();
        this.setItem(idTokenKey, idToken);
    }

    /**
     * fetch the accessToken credential
     * @param accessTokenKey - lookup key to fetch cache type AccessTokenEntity
     */
    getAccessTokenCredential(accessTokenKey: string): AccessTokenEntity | null {
        const accessToken = this.getItem(accessTokenKey) as AccessTokenEntity;
        if (AccessTokenEntity.isAccessTokenEntity(accessToken)) {
            return accessToken;
        }
        return null;
    }

    /**
     * set accessToken credential
     * @param accessToken -  cache value to be set of type AccessTokenEntity
     */
    setAccessTokenCredential(accessToken: AccessTokenEntity): void {
        const accessTokenKey = accessToken.generateCredentialKey();
        this.setItem(accessTokenKey, accessToken);
    }

    /**
     * fetch the refreshToken credential
     * @param refreshTokenKey - lookup key to fetch cache type RefreshTokenEntity
     */
    getRefreshTokenCredential(
        refreshTokenKey: string
    ): RefreshTokenEntity | null {
        const refreshToken = this.getItem(
            refreshTokenKey
        ) as RefreshTokenEntity;
        if (RefreshTokenEntity.isRefreshTokenEntity(refreshToken)) {
            return refreshToken as RefreshTokenEntity;
        }
        return null;
    }

    /**
     * set refreshToken credential
     * @param refreshToken - cache value to be set of type RefreshTokenEntity
     */
    setRefreshTokenCredential(refreshToken: RefreshTokenEntity): void {
        const refreshTokenKey = refreshToken.generateCredentialKey();
        this.setItem(refreshTokenKey, refreshToken);
    }

    /**
     * fetch appMetadata entity from the platform cache
     * @param appMetadataKey - lookup key to fetch cache type AppMetadataEntity
     */
    getAppMetadata(appMetadataKey: string): AppMetadataEntity | null {
        const appMetadata: AppMetadataEntity = this.getItem(
            appMetadataKey
        ) as AppMetadataEntity;
        if (
            AppMetadataEntity.isAppMetadataEntity(appMetadataKey, appMetadata)
        ) {
            return appMetadata;
        }
        return null;
    }

    /**
     * set appMetadata entity to the platform cache
     * @param appMetadata - cache value to be set of type AppMetadataEntity
     */
    setAppMetadata(appMetadata: AppMetadataEntity): void {
        const appMetadataKey = appMetadata.generateAppMetadataKey();
        this.setItem(appMetadataKey, appMetadata);
    }

    /**
     * fetch server telemetry entity from the platform cache
     * @param serverTelemetrykey - lookup key to fetch cache type ServerTelemetryEntity
     */
    getServerTelemetry(
        serverTelemetrykey: string
    ): ServerTelemetryEntity | null {
        const serverTelemetryEntity: ServerTelemetryEntity = this.getItem(
            serverTelemetrykey
        ) as ServerTelemetryEntity;
        if (
            serverTelemetryEntity &&
            ServerTelemetryEntity.isServerTelemetryEntity(
                serverTelemetrykey,
                serverTelemetryEntity
            )
        ) {
            return serverTelemetryEntity;
        }
        return null;
    }

    /**
     * set server telemetry entity to the platform cache
     * @param serverTelemetryKey - lookup key to fetch cache type ServerTelemetryEntity
     * @param serverTelemetry - cache value to be set of type ServerTelemetryEntity
     */
    setServerTelemetry(
        serverTelemetryKey: string,
        serverTelemetry: ServerTelemetryEntity
    ): void {
        this.setItem(serverTelemetryKey, serverTelemetry);
    }

    /**
     * fetch authority metadata entity from the platform cache
     * @param key - lookup key to fetch cache type AuthorityMetadataEntity
     */
    getAuthorityMetadata(key: string): AuthorityMetadataEntity | null {
        const authorityMetadataEntity: AuthorityMetadataEntity = this.getItem(
            key
        ) as AuthorityMetadataEntity;
        if (
            authorityMetadataEntity &&
            AuthorityMetadataEntity.isAuthorityMetadataEntity(
                key,
                authorityMetadataEntity
            )
        ) {
            return authorityMetadataEntity;
        }
        return null;
    }

    /**
     * Get all authority metadata keys
     */
    getAuthorityMetadataKeys(): Array<string> {
        return this.getKeys().filter((key) => {
            return this.isAuthorityMetadata(key);
        });
    }

    /**
     * set authority metadata entity to the platform cache
     * @param key - lookup key to fetch cache type AuthorityMetadataEntity
     * @param metadata - cache value to be set of type AuthorityMetadataEntity
     */
    setAuthorityMetadata(key: string, metadata: AuthorityMetadataEntity): void {
        this.setItem(key, metadata);
    }

    /**
     * fetch throttling entity from the platform cache
     * @param throttlingCacheKey - lookup key to fetch cache type ThrottlingEntity
     */
    getThrottlingCache(throttlingCacheKey: string): ThrottlingEntity | null {
        const throttlingCache: ThrottlingEntity = this.getItem(
            throttlingCacheKey
        ) as ThrottlingEntity;
        if (
            throttlingCache &&
            ThrottlingEntity.isThrottlingEntity(
                throttlingCacheKey,
                throttlingCache
            )
        ) {
            return throttlingCache;
        }
        return null;
    }

    /**
     * set throttling entity to the platform cache
     * @param throttlingCacheKey - lookup key to fetch cache type ThrottlingEntity
     * @param throttlingCache - cache value to be set of type ThrottlingEntity
     */
    setThrottlingCache(
        throttlingCacheKey: string,
        throttlingCache: ThrottlingEntity
    ): void {
        this.setItem(throttlingCacheKey, throttlingCache);
    }

    /**
     * Removes the cache item from memory with the given key.
     * @param key - lookup key to remove a cache entity
     * @param inMemory - key value map of the cache
     */
    removeItem(key: string): boolean {
        this.logger.tracePii(`Item key: ${key}`);

        // read inMemoryCache
        let result: boolean = false;
        const cache = this.getCache();

        if (!!cache[key]) {
            delete cache[key];
            result = true;
        }

        // write to the cache after removal
        if (result) {
            this.setCache(cache);
            this.emitChange();
        }
        return result;
    }

    /**
     * Checks whether key is in cache.
     * @param key - look up key for a cache entity
     */
    containsKey(key: string): boolean {
        return this.getKeys().includes(key);
    }

    /**
     * Gets all keys in window.
     */
    getKeys(): string[] {
        this.logger.trace("Retrieving all cache keys");

        // read cache
        const cache = this.getCache();
        return [...Object.keys(cache)];
    }

    /**
     * Clears all cache entries created by MSAL (except tokens).
     */
    async clear(): Promise<void> {
        this.logger.trace("Clearing cache entries created by MSAL");

        // read inMemoryCache
        const cacheKeys = this.getKeys();

        // delete each element
        cacheKeys.forEach((key) => {
            this.removeItem(key);
        });
        this.emitChange();
    }

    /**
     * Initialize in memory cache from an exisiting cache vault
     * @param cache - blob formatted cache (JSON)
     */
    static generateInMemoryCache(cache: string): InMemoryCache {
        return Deserializer.deserializeAllCache(
            Deserializer.deserializeJSONBlob(cache)
        );
    }

    /**
     * retrieves the final JSON
     * @param inMemoryCache - itemised cache read from the JSON
     */
    static generateJsonCache(inMemoryCache: InMemoryCache): JsonCache {
        return Serializer.serializeAllCache(inMemoryCache);
    }

    /**
     * Updates a credential's cache key if the current cache key is outdated
     */
    updateCredentialCacheKey(
        currentCacheKey: string,
        credential: ValidCredentialType
    ): string {
        const updatedCacheKey = credential.generateCredentialKey();

        if (currentCacheKey !== updatedCacheKey) {
            const cacheItem = this.getItem(currentCacheKey);
            if (cacheItem) {
                this.removeItem(currentCacheKey);
                this.setItem(updatedCacheKey, cacheItem);
                this.logger.verbose(
                    `Updated an outdated ${credential.credentialType} cache key`
                );
                return updatedCacheKey;
            } else {
                this.logger.error(
                    `Attempted to update an outdated ${credential.credentialType} cache key but no item matching the outdated key was found in storage`
                );
            }
        }

        return currentCacheKey;
    }
}
