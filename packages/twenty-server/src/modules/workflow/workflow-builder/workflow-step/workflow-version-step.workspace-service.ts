import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { t } from '@lingui/core/macro';
import { FieldMetadataType } from 'twenty-shared/types';
import { isDefined, isValidUuid } from 'twenty-shared/utils';
import { StepStatus } from 'twenty-shared/workflow';
import { Repository } from 'typeorm';
import { v4 } from 'uuid';

import { BASE_TYPESCRIPT_PROJECT_INPUT_SCHEMA } from 'src/engine/core-modules/serverless/drivers/constants/base-typescript-project-input-schema';
import { CreateWorkflowVersionStepInput } from 'src/engine/core-modules/workflow/dtos/create-workflow-version-step-input.dto';
import { WorkflowActionDTO } from 'src/engine/core-modules/workflow/dtos/workflow-step.dto';
import { AgentChatService } from 'src/engine/metadata-modules/agent/agent-chat.service';
import { AgentService } from 'src/engine/metadata-modules/agent/agent.service';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { ServerlessFunctionService } from 'src/engine/metadata-modules/serverless-function/serverless-function.service';
import { ScopedWorkspaceContextFactory } from 'src/engine/twenty-orm/factories/scoped-workspace-context.factory';
import { TwentyORMGlobalManager } from 'src/engine/twenty-orm/twenty-orm-global.manager';
import {
  WorkflowVersionStepException,
  WorkflowVersionStepExceptionCode,
} from 'src/modules/workflow/common/exceptions/workflow-version-step.exception';
import { WorkflowVersionWorkspaceEntity } from 'src/modules/workflow/common/standard-objects/workflow-version.workspace-entity';
import { assertWorkflowVersionIsDraft } from 'src/modules/workflow/common/utils/assert-workflow-version-is-draft.util';
import { WorkflowCommonWorkspaceService } from 'src/modules/workflow/common/workspace-services/workflow-common.workspace-service';
import { WorkflowSchemaWorkspaceService } from 'src/modules/workflow/workflow-builder/workflow-schema/workflow-schema.workspace-service';
import { insertStep } from 'src/modules/workflow/workflow-builder/workflow-step/utils/insert-step';
import { removeStep } from 'src/modules/workflow/workflow-builder/workflow-step/utils/remove-step';
import { BaseWorkflowActionSettings } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action-settings.type';
import {
  WorkflowAction,
  WorkflowActionType,
  WorkflowFormAction,
} from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';
import { WorkflowRunWorkspaceService } from 'src/modules/workflow/workflow-runner/workflow-run/workflow-run.workspace-service';
import { WorkflowRunnerWorkspaceService } from 'src/modules/workflow/workflow-runner/workspace-services/workflow-runner.workspace-service';

const TRIGGER_STEP_ID = 'trigger';

const BASE_STEP_DEFINITION: BaseWorkflowActionSettings = {
  outputSchema: {},
  errorHandlingOptions: {
    continueOnFailure: {
      value: false,
    },
    retryOnFailure: {
      value: false,
    },
  },
};

@Injectable()
export class WorkflowVersionStepWorkspaceService {
  constructor(
    private readonly twentyORMGlobalManager: TwentyORMGlobalManager,
    private readonly workflowSchemaWorkspaceService: WorkflowSchemaWorkspaceService,
    private readonly serverlessFunctionService: ServerlessFunctionService,
    private readonly agentService: AgentService,
    @InjectRepository(ObjectMetadataEntity, 'core')
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    private readonly workflowRunWorkspaceService: WorkflowRunWorkspaceService,
    private readonly workflowRunnerWorkspaceService: WorkflowRunnerWorkspaceService,
    private readonly agentChatService: AgentChatService,
    private readonly workflowCommonWorkspaceService: WorkflowCommonWorkspaceService,
    private readonly scopedWorkspaceContextFactory: ScopedWorkspaceContextFactory,
  ) {}

  async createWorkflowVersionStep({
    workspaceId,
    input,
  }: {
    workspaceId: string;
    input: CreateWorkflowVersionStepInput;
  }): Promise<WorkflowActionDTO> {
    const { workflowVersionId, stepType, parentStepId, nextStepId } = input;

    const newStep = await this.getStepDefaultDefinition({
      type: stepType,
      workspaceId,
    });
    const enrichedNewStep = await this.enrichOutputSchema({
      step: newStep,
      workspaceId,
    });
    const workflowVersionRepository =
      await this.twentyORMGlobalManager.getRepositoryForWorkspace<WorkflowVersionWorkspaceEntity>(
        workspaceId,
        'workflowVersion',
        { shouldBypassPermissionChecks: true },
      );

    const workflowVersion = await workflowVersionRepository.findOne({
      where: {
        id: workflowVersionId,
      },
    });

    if (!isDefined(workflowVersion)) {
      throw new WorkflowVersionStepException(
        'WorkflowVersion not found',
        WorkflowVersionStepExceptionCode.NOT_FOUND,
      );
    }

    assertWorkflowVersionIsDraft(workflowVersion);

    const existingSteps = workflowVersion.steps || [];

    const { updatedSteps, updatedInsertedStep } = insertStep({
      existingSteps,
      insertedStep: enrichedNewStep,
      parentStepId,
      nextStepId,
    });

    await workflowVersionRepository.update(workflowVersion.id, {
      steps: updatedSteps,
    });

    return updatedInsertedStep;
  }

  async updateWorkflowVersionStep({
    workspaceId,
    workflowVersionId,
    step,
  }: {
    workspaceId: string;
    workflowVersionId: string;
    step: WorkflowAction;
  }): Promise<WorkflowAction> {
    const workflowVersionRepository =
      await this.twentyORMGlobalManager.getRepositoryForWorkspace<WorkflowVersionWorkspaceEntity>(
        workspaceId,
        'workflowVersion',
        { shouldBypassPermissionChecks: true },
      );

    const workflowVersion = await workflowVersionRepository.findOne({
      where: {
        id: workflowVersionId,
      },
    });

    if (!isDefined(workflowVersion)) {
      throw new WorkflowVersionStepException(
        'WorkflowVersion not found',
        WorkflowVersionStepExceptionCode.NOT_FOUND,
      );
    }

    assertWorkflowVersionIsDraft(workflowVersion);

    if (!isDefined(workflowVersion.steps)) {
      throw new WorkflowVersionStepException(
        "Can't update step from undefined steps",
        WorkflowVersionStepExceptionCode.UNDEFINED,
      );
    }

    const enrichedNewStep = await this.enrichOutputSchema({
      step,
      workspaceId,
    });

    const updatedSteps = workflowVersion.steps.map((existingStep) => {
      if (existingStep.id === step.id) {
        return enrichedNewStep;
      } else {
        return existingStep;
      }
    });

    await workflowVersionRepository.update(workflowVersion.id, {
      steps: updatedSteps,
    });

    return enrichedNewStep;
  }

  async deleteWorkflowVersionStep({
    workspaceId,
    workflowVersionId,
    stepIdToDelete,
  }: {
    workspaceId: string;
    workflowVersionId: string;
    stepIdToDelete: string;
  }): Promise<WorkflowActionDTO> {
    const workflowVersionRepository =
      await this.twentyORMGlobalManager.getRepositoryForWorkspace<WorkflowVersionWorkspaceEntity>(
        workspaceId,
        'workflowVersion',
        { shouldBypassPermissionChecks: true },
      );

    const workflowVersion = await workflowVersionRepository.findOne({
      where: {
        id: workflowVersionId,
      },
    });

    if (!isDefined(workflowVersion)) {
      throw new WorkflowVersionStepException(
        'WorkflowVersion not found',
        WorkflowVersionStepExceptionCode.NOT_FOUND,
      );
    }

    assertWorkflowVersionIsDraft(workflowVersion);

    if (!isDefined(workflowVersion.steps)) {
      throw new WorkflowVersionStepException(
        "Can't delete step from undefined steps",
        WorkflowVersionStepExceptionCode.UNDEFINED,
      );
    }

    const stepToDelete = workflowVersion.steps.find(
      (step) => step.id === stepIdToDelete,
    );

    if (!isDefined(stepToDelete)) {
      throw new WorkflowVersionStepException(
        "Can't delete not existing step",
        WorkflowVersionStepExceptionCode.NOT_FOUND,
      );
    }

    const workflowVersionUpdates =
      stepIdToDelete === TRIGGER_STEP_ID
        ? { trigger: null }
        : {
            steps: removeStep({
              existingSteps: workflowVersion.steps,
              stepIdToDelete,
              stepToDeleteChildrenIds: stepToDelete.nextStepIds,
            }),
          };

    await workflowVersionRepository.update(
      workflowVersion.id,
      workflowVersionUpdates,
    );

    await this.runWorkflowVersionStepDeletionSideEffects({
      step: stepToDelete,
      workspaceId,
    });

    return stepToDelete;
  }

  async duplicateStep({
    step,
    workspaceId,
  }: {
    step: WorkflowAction;
    workspaceId: string;
  }): Promise<WorkflowAction> {
    switch (step.type) {
      case WorkflowActionType.CODE: {
        await this.serverlessFunctionService.usePublishedVersionAsDraft({
          id: step.settings.input.serverlessFunctionId,
          version: step.settings.input.serverlessFunctionVersion,
          workspaceId,
        });

        return {
          ...step,
          settings: {
            ...step.settings,
            input: {
              ...step.settings.input,
              serverlessFunctionVersion: 'draft',
            },
          },
        };
      }
      default: {
        return step;
      }
    }
  }

  async submitFormStep({
    workspaceId,
    stepId,
    workflowRunId,
    response,
  }: {
    workspaceId: string;
    stepId: string;
    workflowRunId: string;
    response: object;
  }) {
    const workflowRun =
      await this.workflowRunWorkspaceService.getWorkflowRunOrFail({
        workflowRunId,
        workspaceId,
      });

    const step = workflowRun.state?.flow?.steps?.find(
      (step) => step.id === stepId,
    );

    if (!isDefined(step)) {
      throw new WorkflowVersionStepException(
        'Step not found',
        WorkflowVersionStepExceptionCode.NOT_FOUND,
      );
    }

    if (step.type !== WorkflowActionType.FORM) {
      throw new WorkflowVersionStepException(
        'Step is not a form',
        WorkflowVersionStepExceptionCode.INVALID,
        {
          userFriendlyMessage: t`Step is not a form`,
        },
      );
    }

    const enrichedResponse = await this.enrichFormStepResponse({
      workspaceId,
      step,
      response,
    });

    await this.workflowRunWorkspaceService.updateWorkflowRunStepInfo({
      stepId,
      stepInfo: {
        status: StepStatus.SUCCESS,
        result: enrichedResponse,
      },
      workspaceId,
      workflowRunId,
    });

    await this.workflowRunnerWorkspaceService.resume({
      workspaceId,
      workflowRunId,
      lastExecutedStepId: stepId,
    });
  }

  private async enrichOutputSchema({
    step,
    workspaceId,
  }: {
    step: WorkflowAction;
    workspaceId: string;
  }): Promise<WorkflowAction> {
    // We don't enrich on the fly for code and HTTP request workflow actions.
    // For code actions, OutputSchema is computed and updated when testing the serverless function.
    // For HTTP requests and AI agent, OutputSchema is determined by the expamle response input
    if (
      [
        WorkflowActionType.CODE,
        WorkflowActionType.HTTP_REQUEST,
        WorkflowActionType.AI_AGENT,
      ].includes(step.type)
    ) {
      return step;
    }

    const result = { ...step };
    const outputSchema =
      await this.workflowSchemaWorkspaceService.computeStepOutputSchema({
        step,
        workspaceId,
      });

    result.settings = {
      ...result.settings,
      outputSchema: outputSchema || {},
    };

    return result;
  }

  private async runWorkflowVersionStepDeletionSideEffects({
    step,
    workspaceId,
  }: {
    step: WorkflowAction;
    workspaceId: string;
  }) {
    switch (step.type) {
      case WorkflowActionType.CODE: {
        if (
          !(await this.serverlessFunctionService.hasServerlessFunctionPublishedVersion(
            step.settings.input.serverlessFunctionId,
          ))
        ) {
          await this.serverlessFunctionService.deleteOneServerlessFunction({
            id: step.settings.input.serverlessFunctionId,
            workspaceId,
            softDelete: false,
          });
        }
        break;
      }
      case WorkflowActionType.AI_AGENT: {
        if (!isDefined(step.settings.input.agentId)) {
          break;
        }

        const agent = await this.agentService.findOneAgent(
          step.settings.input.agentId,
          workspaceId,
        );

        if (isDefined(agent)) {
          await this.agentService.deleteOneAgent(agent.id, workspaceId);
        }
        break;
      }
    }
  }

  private async getStepDefaultDefinition({
    type,
    workspaceId,
  }: {
    type: WorkflowActionType;
    workspaceId: string;
  }): Promise<WorkflowAction> {
    const newStepId = v4();

    switch (type) {
      case WorkflowActionType.CODE: {
        const newServerlessFunction =
          await this.serverlessFunctionService.createOneServerlessFunction(
            {
              name: 'A Serverless Function Code Workflow Step',
              description: '',
            },
            workspaceId,
          );

        if (!isDefined(newServerlessFunction)) {
          throw new WorkflowVersionStepException(
            'Fail to create Code Step',
            WorkflowVersionStepExceptionCode.FAILURE,
          );
        }

        return {
          id: newStepId,
          name: 'Code - Serverless Function',
          type: WorkflowActionType.CODE,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            outputSchema: {
              link: {
                isLeaf: true,
                icon: 'IconVariable',
                tab: 'test',
                label: 'Generate Function Output',
              },
              _outputSchemaType: 'LINK',
            },
            input: {
              serverlessFunctionId: newServerlessFunction.id,
              serverlessFunctionVersion: 'draft',
              serverlessFunctionInput: BASE_TYPESCRIPT_PROJECT_INPUT_SCHEMA,
            },
          },
        };
      }
      case WorkflowActionType.SEND_EMAIL: {
        return {
          id: newStepId,
          name: 'Send Email',
          type: WorkflowActionType.SEND_EMAIL,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            input: {
              connectedAccountId: '',
              email: '',
              subject: '',
              body: '',
            },
          },
        };
      }
      case WorkflowActionType.CREATE_RECORD: {
        const activeObjectMetadataItem =
          await this.objectMetadataRepository.findOne({
            where: { workspaceId, isActive: true, isSystem: false },
          });

        return {
          id: newStepId,
          name: 'Create Record',
          type: WorkflowActionType.CREATE_RECORD,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            input: {
              objectName: activeObjectMetadataItem?.nameSingular || '',
              objectRecord: {},
            },
          },
        };
      }
      case WorkflowActionType.UPDATE_RECORD: {
        const activeObjectMetadataItem =
          await this.objectMetadataRepository.findOne({
            where: { workspaceId, isActive: true, isSystem: false },
          });

        return {
          id: newStepId,
          name: 'Update Record',
          type: WorkflowActionType.UPDATE_RECORD,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            input: {
              objectName: activeObjectMetadataItem?.nameSingular || '',
              objectRecord: {},
              objectRecordId: '',
              fieldsToUpdate: [],
            },
          },
        };
      }
      case WorkflowActionType.DELETE_RECORD: {
        const activeObjectMetadataItem =
          await this.objectMetadataRepository.findOne({
            where: { workspaceId, isActive: true, isSystem: false },
          });

        return {
          id: newStepId,
          name: 'Delete Record',
          type: WorkflowActionType.DELETE_RECORD,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            input: {
              objectName: activeObjectMetadataItem?.nameSingular || '',
              objectRecordId: '',
            },
          },
        };
      }
      case WorkflowActionType.FIND_RECORDS: {
        const activeObjectMetadataItem =
          await this.objectMetadataRepository.findOne({
            where: { workspaceId, isActive: true, isSystem: false },
          });

        return {
          id: newStepId,
          name: 'Search Records',
          type: WorkflowActionType.FIND_RECORDS,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            input: {
              objectName: activeObjectMetadataItem?.nameSingular || '',
              limit: 1,
            },
          },
        };
      }
      case WorkflowActionType.FORM: {
        return {
          id: newStepId,
          name: 'Form',
          type: WorkflowActionType.FORM,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            input: [],
          },
        };
      }
      case WorkflowActionType.FILTER: {
        return {
          id: newStepId,
          name: 'Filter',
          type: WorkflowActionType.FILTER,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            input: {
              stepFilterGroups: [],
              stepFilters: [],
            },
          },
        };
      }
      case WorkflowActionType.HTTP_REQUEST: {
        return {
          id: newStepId,
          name: 'HTTP Request',
          type: WorkflowActionType.HTTP_REQUEST,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            input: {
              url: '',
              method: 'GET',
              headers: {},
              body: {},
            },
          },
        };
      }
      case WorkflowActionType.AI_AGENT: {
        return {
          id: newStepId,
          name: 'AI Agent',
          type: WorkflowActionType.AI_AGENT,
          valid: false,
          settings: {
            ...BASE_STEP_DEFINITION,
            input: {
              agentId: '',
              prompt: '',
            },
          },
        };
      }
      default:
        throw new WorkflowVersionStepException(
          `WorkflowActionType '${type}' unknown`,
          WorkflowVersionStepExceptionCode.UNKNOWN,
        );
    }
  }

  private async enrichFormStepResponse({
    workspaceId,
    step,
    response,
  }: {
    workspaceId: string;
    step: WorkflowFormAction;
    response: object;
  }) {
    const responseKeys = Object.keys(response);

    const enrichedResponses = await Promise.all(
      responseKeys.map(async (key) => {
        // @ts-expect-error legacy noImplicitAny
        if (!isDefined(response[key])) {
          // @ts-expect-error legacy noImplicitAny
          return { key, value: response[key] };
        }

        const field = step.settings.input.find((field) => field.name === key);

        if (
          field?.type === 'RECORD' &&
          field?.settings?.objectName &&
          // @ts-expect-error legacy noImplicitAny
          isDefined(response[key].id) &&
          // @ts-expect-error legacy noImplicitAny
          isValidUuid(response[key].id)
        ) {
          const objectMetadataInfo =
            await this.workflowCommonWorkspaceService.getObjectMetadataItemWithFieldsMaps(
              field.settings.objectName,
              workspaceId,
            );

          const relationFieldsNames = Object.values(
            objectMetadataInfo.objectMetadataItemWithFieldsMaps.fieldsById,
          )
            .filter((field) => field.type === FieldMetadataType.RELATION)
            .map((field) => field.name);

          const repository =
            await this.twentyORMGlobalManager.getRepositoryForWorkspace(
              workspaceId,
              field.settings.objectName,
              { shouldBypassPermissionChecks: true },
            );

          const record = await repository.findOne({
            // @ts-expect-error legacy noImplicitAny
            where: { id: response[key].id },
            relations: relationFieldsNames,
          });

          return { key, value: record };
        } else {
          // @ts-expect-error legacy noImplicitAny
          return { key, value: response[key] };
        }
      }),
    );

    return enrichedResponses.reduce((acc, { key, value }) => {
      // @ts-expect-error legacy noImplicitAny
      acc[key] = value;

      return acc;
    }, {});
  }
}
