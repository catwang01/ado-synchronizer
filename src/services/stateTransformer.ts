import * as vscode from 'vscode';
import { ProcessType } from './processType';
import { LocalWorkItemState } from './localWorkItemState';
import { RemoteWorkItemState } from './interfaces/RemoteWorkItemState';

export interface StateTransformRule {
    localState: LocalWorkItemState;
    adoState: RemoteWorkItemState;
}

export class StateTransformer {
    private static getStateMap(process: ProcessType): StateTransformRule[] {
        const baseRules: StateTransformRule[] = [
            { localState: LocalWorkItemState.PROPOSED, adoState: RemoteWorkItemState.NEW },
            { localState: LocalWorkItemState.STARTED, adoState: RemoteWorkItemState.ACTIVE },
            { localState: LocalWorkItemState.COMPLETED, adoState: RemoteWorkItemState.CLOSED },
            { localState: LocalWorkItemState.CUT, adoState: RemoteWorkItemState.REMOVED }
        ];

        switch (process) {
            case ProcessType.AGILE:
                return baseRules;
            case ProcessType.SCRUM:
                return [
                    { localState: LocalWorkItemState.PROPOSED, adoState: RemoteWorkItemState.NEW },
                    { localState: LocalWorkItemState.COMMITTED, adoState: RemoteWorkItemState.COMMITTED },
                    { localState: LocalWorkItemState.STARTED, adoState: RemoteWorkItemState.ACTIVE },
                    { localState: LocalWorkItemState.COMPLETED, adoState: RemoteWorkItemState.DONE },
                    { localState: LocalWorkItemState.CUT, adoState: RemoteWorkItemState.REMOVED }
                ];
            case ProcessType.BASIC:
                return [
                    { localState: LocalWorkItemState.PROPOSED, adoState: RemoteWorkItemState.TODO },
                    { localState: LocalWorkItemState.STARTED, adoState: RemoteWorkItemState.DOING },
                    { localState: LocalWorkItemState.COMPLETED, adoState: RemoteWorkItemState.DONE }
                ];
            case ProcessType.CMMI:
                return [
                    { localState: LocalWorkItemState.PROPOSED, adoState: RemoteWorkItemState.PROPOSED },
                    { localState: LocalWorkItemState.STARTED, adoState: RemoteWorkItemState.ACTIVE },
                    { localState: LocalWorkItemState.COMPLETED, adoState: RemoteWorkItemState.CLOSED },
                    { localState: LocalWorkItemState.CUT, adoState: RemoteWorkItemState.REMOVED }
                ];
            default:
                return baseRules;
        }
    }

    static get processType() {
        const config = vscode.workspace.getConfiguration('markdown-ado-sync');
        const processType = config.get<string>('processType');
        return processType as ProcessType;
    }

    static toAdoState(localState: LocalWorkItemState, type: string): RemoteWorkItemState {
        const stateMap = this.getStateMap(this.processType);
        const rule = stateMap.find(r => r.localState === localState);
        if (!rule) {
            throw new Error(`无法将本地状态 "${localState}" 转换为 ADO 状态 (工作项类型: ${type})`);
        }
        return rule.adoState;
    }

    static toLocalState(adoState: RemoteWorkItemState, type: string): LocalWorkItemState {
        const stateMap = this.getStateMap(this.processType);
        
        const rule = stateMap.find(r => r.adoState === adoState);
        if (!rule) {
            throw new Error(`无法将 ADO 状态 "${adoState}" 转换为本地状态 (工作项类型: ${type})`);
        }
        return rule.localState;
    }

    static getAvailableLocalStates(): LocalWorkItemState[] {
        return this.getStateMap(this.processType).map(rule => rule.localState);
    }

    static getAvailableAdoStates(): RemoteWorkItemState[] {
        return this.getStateMap(this.processType).map(rule => rule.adoState);
    }
} 