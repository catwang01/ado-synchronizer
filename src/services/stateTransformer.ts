export interface StateTransformRule {
    localState: string;
    adoState: string;
}

export class StateTransformer {
    private static readonly STATE_MAPS: { [type: string]: StateTransformRule[] } = {
        'ToDo': [
            { localState: 'To Do', adoState: 'New' },
            { localState: 'Doing', adoState: 'Active' },
            { localState: 'Done', adoState: 'Closed' }
        ],
        'Doing': [
            { localState: 'To Do', adoState: 'Proposed' },
            { localState: 'Doing', adoState: 'Active' },
            { localState: 'Done', adoState: 'Resolved' }
        ],
        'Done': [
            { localState: 'To Do', adoState: 'Proposed' },
            { localState: 'Doing', adoState: 'In Progress' },
            { localState: 'Done', adoState: 'Completed' }
        ]
    };

    private static readonly DEFAULT_TYPE = 'ToDo';
    private static readonly DEFAULT_STATE = 'To Do';

    /**
     * 将本地状态转换为 ADO 工作项状态
     * @param localState 本地状态
     * @param type 工作项类型
     * @returns ADO 工作项状态
     */
    static toAdoState(localState: string, type: string): string {
        const typeMap = this.STATE_MAPS[type] || this.STATE_MAPS[this.DEFAULT_TYPE];
        const rule = typeMap.find(r => r.localState === localState);
        return rule?.adoState || this.DEFAULT_STATE;
    }

    /**
     * 将 ADO 工作项状态转换为本地状态
     * @param adoState ADO 工作项状态
     * @param type 工作项类型
     * @returns 本地状态
     */
    static toLocalState(adoState: string, type: string): string {
        const typeMap = this.STATE_MAPS[type] || this.STATE_MAPS[this.DEFAULT_TYPE];
        const rule = typeMap.find(r => r.adoState === adoState);
        return rule?.localState || 'To Do';
    }

    /**
     * 获取指定类型的所有可用本地状态
     * @param type 工作项类型
     * @returns 本地状态列表
     */
    static getAvailableLocalStates(type: string): string[] {
        const typeMap = this.STATE_MAPS[type] || this.STATE_MAPS[this.DEFAULT_TYPE];
        return typeMap.map(rule => rule.localState);
    }

    /**
     * 获取指定类型的所有可用 ADO 状态
     * @param type 工作项类型
     * @returns ADO 状态列表
     */
    static getAvailableAdoStates(type: string): string[] {
        const typeMap = this.STATE_MAPS[type] || this.STATE_MAPS[this.DEFAULT_TYPE];
        return typeMap.map(rule => rule.adoState);
    }

    /**
     * 验证本地状态对于指定类型是否有效
     * @param localState 本地状态
     * @param type 工作项类型
     * @returns 是否有效
     */
    static isValidLocalState(localState: string, type: string): boolean {
        return this.getAvailableLocalStates(type).includes(localState);
    }
} 