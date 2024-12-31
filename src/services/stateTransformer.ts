import { WorkItemType } from './workItemType';
import { LocalWorkItemState } from './localWorkItemState';
import { RemoteWorkItemState } from './interfaces/RemoteWorkItemState';

export interface StateTransformRule {
    localState: LocalWorkItemState;
    adoState: RemoteWorkItemState;
}

export class StateTransformer {
    private static readonly STATE_MAPS: { [type: string]: StateTransformRule[] } = {
        [WorkItemType.EPIC]: [
            { localState: LocalWorkItemState.PROPOSED, adoState: RemoteWorkItemState.TODO },
            { localState: LocalWorkItemState.STARTED, adoState: RemoteWorkItemState.DOING },
            { localState: LocalWorkItemState.CUT, adoState: RemoteWorkItemState.DONE },
            { localState: LocalWorkItemState.COMPLETED, adoState: RemoteWorkItemState.DONE }
        ], 
        [WorkItemType.ISSUE]: [
            { localState: LocalWorkItemState.PROPOSED, adoState: RemoteWorkItemState.TODO },
            { localState: LocalWorkItemState.STARTED, adoState: RemoteWorkItemState.DOING },
            { localState: LocalWorkItemState.CUT, adoState: RemoteWorkItemState.DONE },
            { localState: LocalWorkItemState.COMPLETED, adoState: RemoteWorkItemState.DONE }
        ], 
        [WorkItemType.TASK]: [
            { localState: LocalWorkItemState.PROPOSED, adoState: RemoteWorkItemState.TODO },
            { localState: LocalWorkItemState.STARTED, adoState: RemoteWorkItemState.DOING },
            { localState: LocalWorkItemState.CUT, adoState: RemoteWorkItemState.DONE },
            { localState: LocalWorkItemState.COMPLETED, adoState: RemoteWorkItemState.DONE }
        ]
    };

    static readonly DEFAULT_STATE = LocalWorkItemState.PROPOSED;
    static readonly DEFAULT_TYPE = WorkItemType.EPIC;

    static validateType(type?: string): boolean {
        return type !== undefined && Object.keys(this.STATE_MAPS).includes(type);
    }

    private static getTypeMap(type: string): StateTransformRule[] {
        if (!this.validateType(type)) {
            throw new Error(`不支持的工作项类型: ${type}`);
        }
        return this.STATE_MAPS[type];
    }

    /**
     * 将本地状态转换为 ADO 工作项状态
     */
    static toAdoState(localState: LocalWorkItemState, type: string): RemoteWorkItemState {
        const typeMap = this.getTypeMap(type);
        const rule = typeMap.find((r: StateTransformRule) => r.localState === localState);
        if (!rule) {
            throw new Error(`无法将本地状态 "${localState}" 转换为 ADO 状态 (工作项类型: ${type})`);
        }
        return rule.adoState;
    }

    /**
     * 将 ADO 工作项状态转换为本地状态
     */
    static toLocalState(adoState: RemoteWorkItemState, type: string): LocalWorkItemState {
        const typeMap = this.getTypeMap(type);
        const rule = typeMap.find((r: StateTransformRule) => r.adoState === adoState);
        if (!rule) {
            throw new Error(`无法将 ADO 状态 "${adoState}" 转换为本地状态 (工作项类型: ${type})`);
        }
        return rule.localState;
    }

    /**
     * 获取指定类型的所有可用本地状态
     */
    static getAvailableLocalStates(type: string): LocalWorkItemState[] {
        return this.getTypeMap(type).map((rule: StateTransformRule) => rule.localState);
    }

    /**
     * 获取指定类型的所有可用 ADO 状态
     */
    static getAvailableAdoStates(type: string): RemoteWorkItemState[] {
        return this.getTypeMap(type).map((rule: StateTransformRule) => rule.adoState);
    }

    /**
     * 验证本地状态对于指定类型是否有效
     */
    static isValidLocalState(localState: LocalWorkItemState, type: string): boolean {
        return this.getAvailableLocalStates(type).includes(localState);
    }
} 