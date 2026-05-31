import { NextResponse } from 'next/server'

const ASSISTANT_MODELING_SYSTEM_PROMPT = `
당신은 규제 기반 3D 건축 설계 편집 어시스턴트입니다.
사용자의 질문, 답변, 마우스 마킹, 현재 floorPlans/gridState/modelEditState/regulations를 함께 해석해 평면과 3D 모델을 개선하는 실행 가능한 계획안을 만듭니다.

핵심 원칙:
1. 원래 본건물 매스, 건축면적, 바닥면적에 영향을 주는 수정은 gridState 기반 평면 그리드 명령으로만 제안합니다.
2. 면적 산정에서 제외되는 보조 돌출, 캐노피, 지붕 등은 modelEditState 명령으로 분리합니다.
3. 법규 확인이 필요한 항목은 바로 단정하지 말고 requiresCodeReview=true로 표시하고, 필요한 법령/MCP 조회 항목을 함께 제시합니다.
4. 사용자의 마킹과 답변이 불충분하면 모델을 수정하지 말고 추가 질문을 생성합니다.
5. 하나의 질문에는 답변 요구사항을 최대 3개까지만 둡니다. 3개를 초과하면 질문을 분리합니다.
6. 하나의 질문 안에서 여러 답변이 필요하면 answerItems를 사용합니다. 각 answerItem은 color, label, answerText, marks를 가지며 최대 3개입니다.
7. 기본 answerItem 색상은 red(주요 수정/배치), blue(동선/연결/방향), orange(조건/주의/제외)입니다.
8. 수정안은 즉시 확정하지 말고 항상 proposal과 commands로 반환합니다. 사용자가 적용해야만 실제 상태에 반영됩니다.
9. 각 proposal은 적용, 초기화, 이전단계, 재시도, 추가요청이 가능한 버전형 제안이어야 합니다.
10. 명령은 반드시 구조화된 JSON으로 작성하고, 자연어 설명만으로 끝내지 않습니다.
`.trim()

const ASSISTANT_COMMAND_SCHEMA_PROMPT = `
반환 형식:
{
  "summary": "제안안 요약",
  "questions": [
    {
      "id": "question_01",
      "title": "질문 1",
      "answerItems": [
        {
          "id": "item_red",
          "color": "red",
          "label": "주요 수정 영역",
          "answerText": "...",
          "markIds": ["mark_..."]
        }
      ]
    }
  ],
  "proposals": [
    {
      "id": "proposal_...",
      "status": "draft",
      "summary": "대안 A",
      "commands": [
        {
          "type": "paintCells",
          "floorId": "floor_01",
          "cellType": "parking|core|corridor|toilet|landscape|main|exclude",
          "targetMarkIds": ["mark_..."],
          "applyScope": "currentFloor|upperFloors|allFloors"
        },
        {
          "type": "createModelAddition",
          "floorId": "floor_01",
          "targetMarkIds": ["mark_..."],
          "heightM": 1.0
        },
        {
          "type": "createRoof",
          "floorId": "floor_01",
          "targetMarkIds": ["mark_..."],
          "roofType": "flat|gable",
          "heightM": 1.5
        }
      ],
      "historyControls": ["apply", "reset", "undoStep", "retryAlternative", "additionalRequest"],
      "requiresUserConfirmation": true
    }
  ],
  "followUpQuestions": [
    {
      "title": "질문",
      "reason": "추가 정보가 필요한 이유",
      "answerItems": [
        { "color": "red", "label": "답변 슬롯" }
      ]
    }
  ]
}
`.trim()

function assistantPromptBundle() {
  return {
    systemPrompt: ASSISTANT_MODELING_SYSTEM_PROMPT,
    outputSchemaPrompt: ASSISTANT_COMMAND_SCHEMA_PROMPT,
    questionPolicy: {
      maxAnswerItemsPerQuestion: 3,
      splitWhenMoreThanThreeItems: true,
      answerItemColors: [
        { id: 'red', label: '주요 수정/배치 영역', color: '#ef4444' },
        { id: 'blue', label: '동선/연결/방향', color: '#2563eb' },
        { id: 'orange', label: '조건/주의/제외 영역', color: '#f97316' },
      ],
    },
    proposalPolicy: {
      requirePreviewBeforeApply: true,
      historyControls: ['apply', 'reset', 'undoStep', 'retryAlternative', 'additionalRequest'],
      stateTargets: ['gridState', 'modelEditState'],
    },
  }
}

function answerSummary(question) {
  const markCount = (question.marks || []).length
  const answer = String(question.answerText || '').trim()
  return {
    id: question.id,
    title: question.title,
    status: question.status,
    markCount,
    hasAnswer: Boolean(answer),
    answerPreview: answer.length > 120 ? `${answer.slice(0, 120)}...` : answer,
  }
}

function inferAction(question) {
  const text = `${question.prompt || ''} ${question.answerText || ''}`.toLowerCase()
  if (text.includes('주차')) {
    return {
      type: 'parking-layout',
      label: `${question.title}: 표시 영역을 기준으로 주차장 배치안을 검토합니다.`,
      requiresCodeReview: true,
    }
  }
  if (text.includes('계단') || text.includes('core') || text.includes('코어')) {
    return {
      type: 'core-stair-layout',
      label: `${question.title}: 계단실/CORE 전층 배치 조건을 검토합니다.`,
      requiresCodeReview: true,
    }
  }
  if (text.includes('화장실') || text.includes('wc')) {
    return {
      type: 'toilet-layout',
      label: `${question.title}: 화장실 배치와 공용부 연결 조건을 검토합니다.`,
      requiresCodeReview: false,
    }
  }
  if (text.includes('복도')) {
    return {
      type: 'corridor-layout',
      label: `${question.title}: 복도 연결 계획을 검토합니다.`,
      requiresCodeReview: false,
    }
  }
  if (text.includes('조경')) {
    return {
      type: 'landscape-layout',
      label: `${question.title}: 조경 영역 배치와 면적 조건을 검토합니다.`,
      requiresCodeReview: false,
    }
  }
  return {
    type: 'design-note',
    label: `${question.title}: 표시/답변 내용을 설계 메모로 정리합니다.`,
    requiresCodeReview: false,
  }
}

function createDraftCommand(action, question) {
  const targetMarkIds = (question.marks || []).map((mark) => mark.id).filter(Boolean)
  if (action.type === 'parking-layout') {
    return {
      type: 'paintCells',
      floorId: question.marks?.[0]?.floorId || '',
      cellType: 'parking',
      targetMarkIds,
      applyScope: 'currentFloor',
      requiresUserConfirmation: true,
    }
  }
  if (action.type === 'core-stair-layout') {
    return {
      type: 'paintCells',
      floorId: question.marks?.[0]?.floorId || '',
      cellType: 'core',
      targetMarkIds,
      applyScope: 'allFloors',
      requiresUserConfirmation: true,
    }
  }
  if (action.type === 'toilet-layout') {
    return {
      type: 'paintCells',
      floorId: question.marks?.[0]?.floorId || '',
      cellType: 'toilet',
      targetMarkIds,
      applyScope: 'currentFloor',
      requiresUserConfirmation: true,
    }
  }
  if (action.type === 'corridor-layout') {
    return {
      type: 'paintCells',
      floorId: question.marks?.[0]?.floorId || '',
      cellType: 'corridor',
      targetMarkIds,
      applyScope: 'currentFloor',
      requiresUserConfirmation: true,
    }
  }
  if (action.type === 'landscape-layout') {
    return {
      type: 'paintCells',
      floorId: question.marks?.[0]?.floorId || '',
      cellType: 'landscape',
      targetMarkIds,
      applyScope: 'currentFloor',
      requiresUserConfirmation: true,
    }
  }
  return {
    type: 'designNote',
    targetMarkIds,
    note: question.answerText || question.prompt || '',
    requiresUserConfirmation: false,
  }
}

function createProposal(completedQuestions, actions) {
  const commands = completedQuestions.flatMap((question, index) => [
    createDraftCommand(actions[index], question),
  ])
  return {
    id: `proposal_${Date.now()}`,
    status: 'draft',
    summary: '사용자 답변과 마킹을 기반으로 한 1차 수정 제안입니다.',
    commands,
    historyControls: ['apply', 'reset', 'undoStep', 'retryAlternative', 'additionalRequest'],
    requiresUserConfirmation: true,
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const assistantState = body.assistantState || {}
    const context = body.context || {}
    const questions = Array.isArray(assistantState.questions)
      ? assistantState.questions
      : []
    const completedQuestions = questions.filter((question) => question.status === 'completed')
    const actions = completedQuestions.map(inferAction)
    const proposal = createProposal(completedQuestions, actions)
    const markCount = completedQuestions.reduce((sum, question) => sum + (question.marks || []).length, 0)

    return NextResponse.json({
      success: true,
      result: {
        mode: 'mock-ready-for-llm',
        promptBundle: assistantPromptBundle(),
        summary: `${completedQuestions.length}개 답변과 ${markCount}개 표시를 바탕으로 설계 수정 제안 초안을 만들었습니다.`,
        sourceView: body.sourceView || 'unknown',
        modelContext: {
          address: context.address || '',
          floorCount: (context.floorPlans || []).length,
          hasRegulations: Boolean(context.regulations),
          hasGridState: Boolean(context.gridState),
          hasModelEditState: Boolean(context.modelEditState),
        },
        questions: completedQuestions.map(answerSummary),
        actions,
        proposals: [proposal],
        commands: proposal.commands,
        nextStep: '향후 이 라우트에서 법제처 MCP/LLM 호출 후 구조화된 명령을 반환하도록 확장합니다.',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, detail: error.message || 'AI 설계 제안 생성 중 오류가 발생했습니다.' },
      { status: 500 },
    )
  }
}
