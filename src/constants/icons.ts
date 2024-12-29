export const StateIcons = {
    // 同步状态
    'Syncing': '$(sync~spin)',
    'SyncSuccess': '$(check)',
    'SyncFailed': '$(error)',

    // 特殊状态
    'NotSpecified': '$(question)',  // 使用问号图标表示未指定状态

    // Bug 状态
    'Active': '$(bug)',
    'Resolved': '$(check)',
    'Closed': '$(pass)',

    // Task 状态
    'To Do': '$(circle-outline)',
    'Doing': '$(sync)',
    'Done': '$(check)',

    // User Story 状态
    'New': '$(circle-outline)',
    'In Progress': '$(sync)',
    'Completed': '$(check)',

    // Feature 状态
    'Proposed': '$(circle-outline)',
    'In Review': '$(eye)',
    'Under Development': '$(sync)',
    'Complete': '$(check)',
    'Removed': '$(x)',

    // Epic 状态
    'Backlog': '$(circle-outline)',
    'Committed': '$(sync)',
    'Started': '$(play)',
    'Finished': '$(check)',
    'Cut': '$(x)',

    // Issue 状态
    'Open': '$(warning)',
    'Investigation': '$(search)',
    'Fixed': '$(check)',

    // 默认状态
    'default': '$(circle-outline)'
} as const;

export type WorkItemState = keyof typeof StateIcons; 