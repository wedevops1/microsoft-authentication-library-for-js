/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { CommonAuthorizationCodeRequest } from "@bobleujr/msal-common";

export type AuthorizationCodeRequest = Partial<
    Omit<
        CommonAuthorizationCodeRequest,
        "code" | "enableSpaAuthorizationCode" | "requestedClaimsHash"
    >
> & {
    code?: string;
    nativeAccountId?: string;
    cloudGraphHostName?: string;
    msGraphHost?: string;
    cloudInstanceHostName?: string;
};
