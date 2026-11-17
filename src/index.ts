/**
 * diecuttemplates-sdk
 *
 * Dependency-free Node.js/TypeScript SDK for the two diecuttemplates.com REST APIs:
 * the Dielines API (dieline generation, 3D mockups and nesting) and the Dieline Dimensions API
 * (flat dimension calculation without generating files).
 */

export { PRODUCTION_BASE_URL, SANDBOX_BASE_URL } from './constants';

export {
  DiecutApiError,
  DiecutValidationError,
  DiecutAuthError,
  DiecutNotFoundError,
  DiecutRateLimitError,
  mapErrorResponse,
} from './errors';
export type { DiecutValidationIssue, DiecutValidationSuggestion } from './errors';

export type {
  Unit,
  Link,
  DielineTemplateGroupCategory,
  DielineTemplateGroup,
  DielineTemplateStandardCode,
  Credits,
  DielineTemplateFeatureSlot,
  DielineTemplateVariableDataType,
  DielineTemplateVariableDefaultValue,
  DielineTemplateVariableImage,
  DielineTemplateVariable,
  DielineTemplateImage,
  DielineTemplate,
} from './shared/types';

export { DielinesClient } from './dielines/client';
export type { DielinesClientConfig } from './dielines/client';
export type {
  DielineFormat,
  Substrate,
  DielineVariables,
  DielineArtworkDimensions,
  DielineArea,
  DielineSubstratePart,
  DielineActions,
  Dieline,
  DielineListPage,
  DielineTemplateSummary,
  DielineTemplateListPage,
  ListTemplatesParams,
  ListTemplatesExpandedParams,
  ListTemplatesSummaryParams,
  ListTemplatesItem,
  ThreeDMockupActions,
  ThreeDMockup,
  ThreeDMockupListPage,
  NestingTemplateComponent,
  NestingTemplateActions,
  NestingTemplate,
  NestingTemplateListResult,
  NestingEfficiency,
  NestingTemplateEfficiencies,
  NestingLineLength,
  NestingVariables,
  Nesting,
  CreateDielineParams,
  Create3DMockupParams,
  Update3DMockupParams,
  NestingEfficienciesVariables,
  NestingEfficienciesParams,
  CreateNestingVariables,
  CreateNestingParams,
} from './dielines/types';

export { DimensionsClient } from './dimensions/client';
export type { DimensionsClientConfig } from './dimensions/client';
export type {
  PartBoundingBox,
  PartArea,
  Part,
  PartListResult,
  CalculatePartsVariables,
  CalculatePartsParams,
} from './dimensions/types';

import { DielinesClient } from './dielines/client';
import { DimensionsClient } from './dimensions/client';

/** Constructor configuration for {@link DiecutTemplatesSDK}. */
export interface DiecutTemplatesSDKConfig {
  /** Dielines API key. Required to use `.dielines`. */
  dielinesApiKey?: string;
  /** Dieline Dimensions API key. Required to use `.dimensions`. */
  dimensionsApiKey?: string;
  /** Environment to use for both clients. Defaults to `"production"`. */
  environment?: 'production' | 'sandbox';
}

/**
 * Convenience facade that groups {@link DielinesClient} and {@link DimensionsClient} under a
 * single configuration. Each client is instantiated lazily the first time `.dielines` /
 * `.dimensions` is accessed.
 *
 * @example
 * ```ts
 * const sdk = new DiecutTemplatesSDK({
 *   dielinesApiKey: process.env.DIECUT_DIELINES_API_KEY,
 *   dimensionsApiKey: process.env.DIECUT_DIMENSIONS_API_KEY,
 *   environment: 'sandbox',
 * });
 *
 * const groups = await sdk.dielines.listTemplateGroups();
 * const parts = await sdk.dimensions.calculateParts('becf-11101', { variables: { unit: 'mm' } });
 * ```
 */
export class DiecutTemplatesSDK {
  private readonly config: DiecutTemplatesSDKConfig;
  private dielinesClient?: DielinesClient;
  private dimensionsClient?: DimensionsClient;

  constructor(config: DiecutTemplatesSDKConfig) {
    this.config = config;
  }

  /** Dielines API client. Throws if `dielinesApiKey` was not passed to the constructor. */
  get dielines(): DielinesClient {
    if (!this.config.dielinesApiKey) {
      throw new Error(
        'DiecutTemplatesSDK: "dielinesApiKey" is missing from the configuration. Pass it to the constructor to use sdk.dielines.',
      );
    }
    if (!this.dielinesClient) {
      this.dielinesClient = new DielinesClient({
        apiKey: this.config.dielinesApiKey,
        environment: this.config.environment,
      });
    }
    return this.dielinesClient;
  }

  /** Dieline Dimensions API client. Throws if `dimensionsApiKey` was not passed to the constructor. */
  get dimensions(): DimensionsClient {
    if (!this.config.dimensionsApiKey) {
      throw new Error(
        'DiecutTemplatesSDK: "dimensionsApiKey" is missing from the configuration. Pass it to the constructor to use sdk.dimensions.',
      );
    }
    if (!this.dimensionsClient) {
      this.dimensionsClient = new DimensionsClient({
        apiKey: this.config.dimensionsApiKey,
        environment: this.config.environment,
      });
    }
    return this.dimensionsClient;
  }
}
