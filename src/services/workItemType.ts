export enum WorkItemType {
    TASK = 'Task',
    BUG = 'Bug',
    ISSUE = 'Issue',
    FEATURE = 'Feature',
    USER_STORY = 'User Story',
    DELIVERABLE = 'Deliverable',
    SCENARIO = 'Scenario',
    EPIC = 'Epic'
}

export class WorkItemTypeHelper {
   
    private static readonly AVAILABLE_TYPES = [
        WorkItemType.TASK,
        WorkItemType.BUG,
        WorkItemType.ISSUE,
        WorkItemType.FEATURE,
        WorkItemType.USER_STORY,
        WorkItemType.EPIC,
        WorkItemType.DELIVERABLE,
        WorkItemType.SCENARIO
    ];

    /**
     * 获取所有可用的工作项类型
     */
    static getAvailableTypes(): WorkItemType[] {
        return [...this.AVAILABLE_TYPES];
    }

    /**
     * 验证并标准化工作项类型
     */
    static normalize(type?: string): WorkItemType {
        if (!type) {
            throw new Error('Cannot normalize undefined type');
        }

        const normalizedType = type.toLowerCase().trim();
        const foundType = this.AVAILABLE_TYPES.find(t => t.toLowerCase() === normalizedType);
        if (!foundType) {
            throw new Error(`Invalid type: ${normalizedType}`);
        }
        return foundType;
    }

    /**
     * 检查类型是否有效
     */
    static isValid(type: string): boolean {
        try {
            this.normalize(type);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 获取类型的图标名称
     */
    static getIconName(type: WorkItemType): string {
        switch (type) {
            case WorkItemType.BUG:
                return 'bug';
            case WorkItemType.FEATURE:
                return 'star';
            case WorkItemType.ISSUE:
                return 'issues';
            case WorkItemType.USER_STORY:
                return 'book';
            case WorkItemType.EPIC:
                return 'rocket';
            case WorkItemType.TASK:
            default:
                return 'tasklist';
        }
    }
} 