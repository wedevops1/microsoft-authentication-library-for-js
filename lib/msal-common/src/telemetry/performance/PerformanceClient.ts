/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { ApplicationTelemetry } from "../../config/ClientConfiguration";
import { Logger } from "../../logger/Logger";
import {
    InProgressPerformanceEvent,
    IPerformanceClient,
    PerformanceCallbackFunction,
    QueueMeasurement,
} from "./IPerformanceClient";
import { IPerformanceMeasurement } from "./IPerformanceMeasurement";
import {
    Counters,
    IntFields,
    PerformanceEvent,
    PerformanceEvents,
    PerformanceEventStatus,
    StaticFields,
} from "./PerformanceEvent";

export interface PreQueueEvent {
    name: PerformanceEvents;
    time: number;
}

export abstract class PerformanceClient implements IPerformanceClient {
    protected authority: string;
    protected libraryName: string;
    protected libraryVersion: string;
    protected applicationTelemetry: ApplicationTelemetry;
    protected clientId: string;
    protected logger: Logger;
    protected callbacks: Map<string, PerformanceCallbackFunction>;

    /**
     * Multiple events with the same correlation id.
     * @protected
     * @type {Map<string, PerformanceEvent>}
     */
    protected eventsByCorrelationId: Map<string, PerformanceEvent>;

    /**
     * Map of pre-queue times by correlation Id
     *
     * @protected
     * @type {Map<string, PreQueueEvent>}
     */
    protected preQueueTimeByCorrelationId: Map<string, PreQueueEvent>;

    /**
     * Map of queue measurements by correlation Id
     *
     * @protected
     * @type {Map<string, Array<QueueMeasurement>>}
     */
    protected queueMeasurements: Map<string, Array<QueueMeasurement>>;

    /**
     * Creates an instance of PerformanceClient,
     * an abstract class containing core performance telemetry logic.
     *
     * @constructor
     * @param {string} clientId Client ID of the application
     * @param {string} authority Authority used by the application
     * @param {Logger} logger Logger used by the application
     * @param {string} libraryName Name of the library
     * @param {string} libraryVersion Version of the library
     */
    constructor(
        clientId: string,
        authority: string,
        logger: Logger,
        libraryName: string,
        libraryVersion: string,
        applicationTelemetry: ApplicationTelemetry
    ) {
        this.authority = authority;
        this.libraryName = libraryName;
        this.libraryVersion = libraryVersion;
        this.applicationTelemetry = applicationTelemetry;
        this.clientId = clientId;
        this.logger = logger;
        this.callbacks = new Map();
        this.eventsByCorrelationId = new Map();
        this.queueMeasurements = new Map();
        this.preQueueTimeByCorrelationId = new Map();
    }

    /**
     * Generates and returns a unique id, typically a guid.
     *
     * @abstract
     * @returns {string}
     */
    abstract generateId(): string;

    /**
     * Starts and returns an platform-specific implementation of IPerformanceMeasurement.
     * Note: this function can be changed to abstract at the next major version bump.
     *
     * @param {string} measureName
     * @param {string} correlationId
     * @returns {IPerformanceMeasurement}
     */
    startPerformanceMeasurement(
        measureName: string, // eslint-disable-line @typescript-eslint/no-unused-vars
        correlationId: string // eslint-disable-line @typescript-eslint/no-unused-vars
    ): IPerformanceMeasurement {
        return {} as IPerformanceMeasurement;
    }

    /**
     * Sets pre-queue time by correlation Id
     *
     * @abstract
     * @param {PerformanceEvents} eventName
     * @param {string} correlationId
     * @returns
     */
    abstract setPreQueueTime(
        eventName: PerformanceEvents,
        correlationId?: string
    ): void;

    /**
     * Get integral fields.
     * Override to change the set.
     */
    getIntFields(): ReadonlySet<string> {
        return IntFields;
    }

    /**
     * Gets map of pre-queue times by correlation Id
     *
     * @param {PerformanceEvents} eventName
     * @param {string} correlationId
     * @returns {number}
     */
    getPreQueueTime(
        eventName: PerformanceEvents,
        correlationId: string
    ): number | void {
        const preQueueEvent: PreQueueEvent | undefined =
            this.preQueueTimeByCorrelationId.get(correlationId);

        if (!preQueueEvent) {
            this.logger.trace(
                `PerformanceClient.getPreQueueTime: no pre-queue times found for correlationId: ${correlationId}, unable to add queue measurement`
            );
            return;
        } else if (preQueueEvent.name !== eventName) {
            this.logger.trace(
                `PerformanceClient.getPreQueueTime: no pre-queue time found for ${eventName}, unable to add queue measurement`
            );
            return;
        }

        return preQueueEvent.time;
    }

    /**
     * Calculates the difference between current time and time when function was queued.
     * Note: It is possible to have 0 as the queue time if the current time and the queued time was the same.
     *
     * @param {number} preQueueTime
     * @param {number} currentTime
     * @returns {number}
     */
    calculateQueuedTime(preQueueTime: number, currentTime: number): number {
        if (preQueueTime < 1) {
            this.logger.trace(
                `PerformanceClient: preQueueTime should be a positive integer and not ${preQueueTime}`
            );
            return 0;
        }

        if (currentTime < 1) {
            this.logger.trace(
                `PerformanceClient: currentTime should be a positive integer and not ${currentTime}`
            );
            return 0;
        }

        if (currentTime < preQueueTime) {
            this.logger.trace(
                "PerformanceClient: currentTime is less than preQueueTime, check how time is being retrieved"
            );
            return 0;
        }

        return currentTime - preQueueTime;
    }

    /**
     * Adds queue measurement time to QueueMeasurements array for given correlation ID.
     *
     * @param {PerformanceEvents} eventName
     * @param {?string} correlationId
     * @param {?number} queueTime
     * @param {?boolean} manuallyCompleted - indicator for manually completed queue measurements
     * @returns
     */
    addQueueMeasurement(
        eventName: PerformanceEvents,
        correlationId?: string,
        queueTime?: number,
        manuallyCompleted?: boolean
    ): void {
        if (!correlationId) {
            this.logger.trace(
                `PerformanceClient.addQueueMeasurement: correlationId not provided for ${eventName}, cannot add queue measurement`
            );
            return;
        }

        if (queueTime === 0) {
            // Possible for there to be no queue time after calculation
            this.logger.trace(
                `PerformanceClient.addQueueMeasurement: queue time provided for ${eventName} is ${queueTime}`
            );
        } else if (!queueTime) {
            this.logger.trace(
                `PerformanceClient.addQueueMeasurement: no queue time provided for ${eventName}`
            );
            return;
        }

        const queueMeasurement: QueueMeasurement = {
            eventName,
            queueTime,
            manuallyCompleted,
        };

        // Adds to existing correlation Id if present in queueMeasurements
        const existingMeasurements = this.queueMeasurements.get(correlationId);
        if (existingMeasurements) {
            existingMeasurements.push(queueMeasurement);
            this.queueMeasurements.set(correlationId, existingMeasurements);
        } else {
            // Sets new correlation Id if not present in queueMeasurements
            this.logger.trace(
                `PerformanceClient.addQueueMeasurement: adding correlationId ${correlationId} to queue measurements`
            );
            const measurementArray = [queueMeasurement];
            this.queueMeasurements.set(correlationId, measurementArray);
        }
        // Delete processed pre-queue event.
        this.preQueueTimeByCorrelationId.delete(correlationId);
    }

    /**
     * Starts measuring performance for a given operation. Returns a function that should be used to end the measurement.
     *
     * @param {PerformanceEvents} measureName
     * @param {?string} [correlationId]
     * @returns {InProgressPerformanceEvent}
     */
    startMeasurement(
        measureName: PerformanceEvents,
        correlationId?: string
    ): InProgressPerformanceEvent {
        // Generate a placeholder correlation if the request does not provide one
        const eventCorrelationId = correlationId || this.generateId();
        if (!correlationId) {
            this.logger.info(
                `PerformanceClient: No correlation id provided for ${measureName}, generating`,
                eventCorrelationId
            );
        }

        this.logger.trace(
            `PerformanceClient: Performance measurement started for ${measureName}`,
            eventCorrelationId
        );
        const performanceMeasurement = this.startPerformanceMeasurement(
            measureName,
            eventCorrelationId
        );
        performanceMeasurement.startMeasurement();

        const inProgressEvent: PerformanceEvent = {
            eventId: this.generateId(),
            status: PerformanceEventStatus.InProgress,
            authority: this.authority,
            libraryName: this.libraryName,
            libraryVersion: this.libraryVersion,
            clientId: this.clientId,
            name: measureName,
            startTimeMs: Date.now(),
            correlationId: eventCorrelationId,
            appName: this.applicationTelemetry?.appName,
            appVersion: this.applicationTelemetry?.appVersion,
        };

        // Store in progress events so they can be discarded if not ended properly
        this.cacheEventByCorrelationId(inProgressEvent);

        // Return the event and functions the caller can use to properly end/flush the measurement
        return {
            endMeasurement: (
                event?: Partial<PerformanceEvent>
            ): PerformanceEvent | null => {
                return this.endMeasurement(
                    {
                        // Initial set of event properties
                        ...inProgressEvent,
                        // Properties set when event ends
                        ...event,
                    },
                    performanceMeasurement
                );
            },
            discardMeasurement: () => {
                return this.discardMeasurements(inProgressEvent.correlationId);
            },
            addStaticFields: (fields: StaticFields) => {
                return this.addStaticFields(
                    fields,
                    inProgressEvent.correlationId
                );
            },
            increment: (counters: Counters) => {
                return this.increment(counters, inProgressEvent.correlationId);
            },
            measurement: performanceMeasurement,
            event: inProgressEvent,
        };
    }

    /**
     * Stops measuring the performance for an operation. Should only be called directly by PerformanceClient classes,
     * as consumers should instead use the function returned by startMeasurement.
     * Adds a new field named as "[event name]DurationMs" for sub-measurements, completes and emits an event
     * otherwise.
     *
     * @param {PerformanceEvent} event
     * @param {IPerformanceMeasurement} measurement
     * @returns {(PerformanceEvent | null)}
     */
    endMeasurement(
        event: PerformanceEvent,
        measurement?: IPerformanceMeasurement
    ): PerformanceEvent | null {
        const rootEvent: PerformanceEvent | undefined =
            this.eventsByCorrelationId.get(event.correlationId);
        if (!rootEvent) {
            this.logger.trace(
                `PerformanceClient: Measurement not found for ${event.eventId}`,
                event.correlationId
            );
            return null;
        }

        const isRoot = event.eventId === rootEvent.eventId;
        let queueInfo = {
            totalQueueTime: 0,
            totalQueueCount: 0,
            manuallyCompletedCount: 0,
        };
        if (isRoot) {
            queueInfo = this.getQueueInfo(event.correlationId);
            this.discardCache(rootEvent.correlationId);
        } else {
            rootEvent.incompleteSubMeasurements?.delete(event.eventId);
        }

        measurement?.endMeasurement();
        const durationMs = measurement?.flushMeasurement();
        // null indicates no measurement was taken (e.g. needed performance APIs not present)
        if (!durationMs) {
            this.logger.trace(
                "PerformanceClient: Performance measurement not taken",
                rootEvent.correlationId
            );
            return null;
        }

        this.logger.trace(
            `PerformanceClient: Performance measurement ended for ${event.name}: ${durationMs} ms`,
            event.correlationId
        );

        // Add sub-measurement attribute to root event.
        if (!isRoot) {
            rootEvent[event.name + "DurationMs"] = Math.floor(durationMs);
            return { ...rootEvent };
        }

        let finalEvent: PerformanceEvent = { ...rootEvent, ...event };
        let incompleteSubsCount: number = 0;
        // Incomplete sub-measurements are discarded. They are likely an instrumentation bug that should be fixed.
        finalEvent.incompleteSubMeasurements?.forEach((subMeasurement) => {
            this.logger.trace(
                `PerformanceClient: Incomplete submeasurement ${subMeasurement.name} found for ${event.name}`,
                finalEvent.correlationId
            );
            incompleteSubsCount++;
        });
        finalEvent.incompleteSubMeasurements = undefined;

        finalEvent = {
            ...finalEvent,
            durationMs: Math.round(durationMs),
            queuedTimeMs: queueInfo.totalQueueTime,
            queuedCount: queueInfo.totalQueueCount,
            queuedManuallyCompletedCount: queueInfo.manuallyCompletedCount,
            status: PerformanceEventStatus.Completed,
            incompleteSubsCount,
        };
        this.truncateIntegralFields(finalEvent, this.getIntFields());
        this.emitEvents([finalEvent], event.correlationId);

        return finalEvent;
    }

    /**
     * Saves extra information to be emitted when the measurements are flushed
     * @param fields
     * @param correlationId
     */
    addStaticFields(fields: StaticFields, correlationId: string): void {
        this.logger.trace("PerformanceClient: Updating static fields");
        const event = this.eventsByCorrelationId.get(correlationId);
        if (event) {
            this.eventsByCorrelationId.set(correlationId, {
                ...event,
                ...fields,
            });
        } else {
            this.logger.trace(
                "PerformanceClient: Event not found for",
                correlationId
            );
        }
    }

    /**
     * Increment counters to be emitted when the measurements are flushed
     * @param counters {Counters}
     * @param correlationId {string} correlation identifier
     */
    increment(counters: Counters, correlationId: string): void {
        this.logger.trace("PerformanceClient: Updating counters");
        const event = this.eventsByCorrelationId.get(correlationId);
        if (event) {
            for (const counter in counters) {
                if (!event.hasOwnProperty(counter)) {
                    event[counter] = 0;
                }
                event[counter] += counters[counter];
            }
        } else {
            this.logger.trace(
                "PerformanceClient: Event not found for",
                correlationId
            );
        }
    }

    /**
     * Upserts event into event cache.
     * First key is the correlation id, second key is the event id.
     * Allows for events to be grouped by correlation id,
     * and to easily allow for properties on them to be updated.
     *
     * @private
     * @param {PerformanceEvent} event
     */
    private cacheEventByCorrelationId(event: PerformanceEvent) {
        const rootEvent = this.eventsByCorrelationId.get(event.correlationId);
        if (rootEvent) {
            this.logger.trace(
                `PerformanceClient: Performance measurement for ${event.name} added/updated`,
                event.correlationId
            );
            rootEvent.incompleteSubMeasurements =
                rootEvent.incompleteSubMeasurements || new Map();
            rootEvent.incompleteSubMeasurements.set(event.eventId, {
                name: event.name,
                startTimeMs: event.startTimeMs,
            });
        } else {
            this.logger.trace(
                `PerformanceClient: Performance measurement for ${event.name} started`,
                event.correlationId
            );
            this.eventsByCorrelationId.set(event.correlationId, { ...event });
        }
    }

    private getQueueInfo(correlationId: string): {
        totalQueueTime: number;
        totalQueueCount: number;
        manuallyCompletedCount: number;
    } {
        const queueMeasurementForCorrelationId =
            this.queueMeasurements.get(correlationId);
        if (!queueMeasurementForCorrelationId) {
            this.logger.trace(
                `PerformanceClient: no queue measurements found for for correlationId: ${correlationId}`
            );
        }

        let totalQueueTime = 0;
        let totalQueueCount = 0;
        let manuallyCompletedCount = 0;
        queueMeasurementForCorrelationId?.forEach((measurement) => {
            totalQueueTime += measurement.queueTime;
            totalQueueCount++;
            manuallyCompletedCount += measurement.manuallyCompleted ? 1 : 0;
        });

        return {
            totalQueueTime,
            totalQueueCount,
            manuallyCompletedCount,
        };
    }

    /**
     * Removes measurements for a given correlation id.
     *
     * @param {string} correlationId
     */
    discardMeasurements(correlationId: string): void {
        this.logger.trace(
            "PerformanceClient: Performance measurements discarded",
            correlationId
        );
        this.eventsByCorrelationId.delete(correlationId);
    }

    /**
     * Removes cache for a given correlation id.
     *
     * @param {string} correlationId correlation identifier
     */
    private discardCache(correlationId: string): void {
        this.discardMeasurements(correlationId);

        this.logger.trace(
            "PerformanceClient: QueueMeasurements discarded",
            correlationId
        );
        this.queueMeasurements.delete(correlationId);

        this.logger.trace(
            "PerformanceClient: Pre-queue times discarded",
            correlationId
        );
        this.preQueueTimeByCorrelationId.delete(correlationId);
    }

    /**
     * Registers a callback function to receive performance events.
     *
     * @param {PerformanceCallbackFunction} callback
     * @returns {string}
     */
    addPerformanceCallback(callback: PerformanceCallbackFunction): string {
        const callbackId = this.generateId();
        this.callbacks.set(callbackId, callback);
        this.logger.verbose(
            `PerformanceClient: Performance callback registered with id: ${callbackId}`
        );

        return callbackId;
    }

    /**
     * Removes a callback registered with addPerformanceCallback.
     *
     * @param {string} callbackId
     * @returns {boolean}
     */
    removePerformanceCallback(callbackId: string): boolean {
        const result = this.callbacks.delete(callbackId);

        if (result) {
            this.logger.verbose(
                `PerformanceClient: Performance callback ${callbackId} removed.`
            );
        } else {
            this.logger.verbose(
                `PerformanceClient: Performance callback ${callbackId} not removed.`
            );
        }

        return result;
    }

    /**
     * Emits events to all registered callbacks.
     *
     * @param {PerformanceEvent[]} events
     * @param {?string} [correlationId]
     */
    emitEvents(events: PerformanceEvent[], correlationId: string): void {
        this.logger.verbose(
            "PerformanceClient: Emitting performance events",
            correlationId
        );

        this.callbacks.forEach(
            (callback: PerformanceCallbackFunction, callbackId: string) => {
                this.logger.trace(
                    `PerformanceClient: Emitting event to callback ${callbackId}`,
                    correlationId
                );
                callback.apply(null, [events]);
            }
        );
    }

    /**
     * Enforce truncation of integral fields in performance event.
     * @param {PerformanceEvent} event performance event to update.
     * @param {Set<string>} intFields integral fields.
     */
    private truncateIntegralFields(
        event: PerformanceEvent,
        intFields: ReadonlySet<string>
    ): void {
        intFields.forEach((key) => {
            if (key in event && typeof event[key] === "number") {
                event[key] = Math.floor(event[key]);
            }
        });
    }
}
