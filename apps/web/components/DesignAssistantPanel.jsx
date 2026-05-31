'use client'

import { useEffect, useRef, useState } from 'react'

function nextQuestionId(questions) {
  return `question_${String((questions || []).length + 1).padStart(2, '0')}`
}

export function addAssistantMark(assistantState, mark) {
  const activeQuestionId = assistantState?.activeQuestionId
  if (!activeQuestionId) return assistantState
  return {
    ...(assistantState || {}),
    questions: (assistantState.questions || []).map((question) => (
      question.id === activeQuestionId
        ? {
          ...question,
          marks: [
            ...(question.marks || []),
            {
              id: `mark_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              createdAt: Date.now(),
              ...mark,
            },
          ],
        }
        : question
    )),
  }
}

export default function DesignAssistantPanel({
  assistantState,
  onAssistantStateChange,
  onSubmit,
  title = 'AI 설계 어시스턴트',
  viewLabel = '현재 화면',
}) {
  const state = assistantState || { questions: [] }
  const [panelPosition, setPanelPosition] = useState(null)
  const panelDragRef = useRef(null)
  const update = (patch) => {
    onAssistantStateChange?.((current) => ({
      ...(current || {}),
      ...patch,
    }))
  }
  const updateQuestion = (questionId, patch) => {
    onAssistantStateChange?.((current) => ({
      ...(current || {}),
      questions: (current?.questions || []).map((question) => (
        question.id === questionId ? { ...question, ...patch } : question
      )),
    }))
  }
  const startAnswerMode = (questionId) => {
    onAssistantStateChange?.((current) => ({
      ...(current || {}),
      open: true,
      activeQuestionId: questionId,
      questions: (current?.questions || []).map((question) => ({
        ...question,
        status: question.id === questionId ? 'answering' : question.status,
      })),
    }))
  }
  const completeAnswerMode = (questionId) => {
    onAssistantStateChange?.((current) => ({
      ...(current || {}),
      activeQuestionId: current?.activeQuestionId === questionId ? null : current?.activeQuestionId,
      questions: (current?.questions || []).map((question) => (
        question.id === questionId ? { ...question, status: 'completed' } : question
      )),
    }))
  }
  const addQuestion = () => {
    onAssistantStateChange?.((current) => {
      const questions = current?.questions || []
      return {
        ...(current || {}),
        open: true,
        questions: [
          ...questions,
          {
            id: nextQuestionId(questions),
            title: `질문 ${questions.length + 1}`,
            prompt: '추가로 확인할 내용을 입력해주세요. 하나의 질문 안 답변 요구사항은 3개 이하로 구분합니다.',
            status: 'pending',
            answerText: '',
            marks: [],
          },
        ],
      }
    })
  }
  const clearQuestionMarks = (questionId) => {
    updateQuestion(questionId, { marks: [] })
  }
  const startPanelDrag = (event) => {
    const panel = event.currentTarget.closest('.assistant-panel')
    const parent = panel?.parentElement
    if (!panel || !parent) return
    const panelRect = panel.getBoundingClientRect()
    const parentRect = parent.getBoundingClientRect()
    panelDragRef.current = {
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
      parentRect,
    }
    setPanelPosition({
      x: panelRect.left - parentRect.left,
      y: panelRect.top - parentRect.top,
    })
    event.preventDefault()
  }

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!panelDragRef.current) return
      const { offsetX, offsetY, parentRect } = panelDragRef.current
      setPanelPosition({
        x: Math.max(8, Math.min(parentRect.width - 80, event.clientX - parentRect.left - offsetX)),
        y: Math.max(8, Math.min(parentRect.height - 44, event.clientY - parentRect.top - offsetY)),
      })
    }
    const handlePointerUp = () => {
      panelDragRef.current = null
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  const open = Boolean(state.open)
  const allCompleted = (state.questions || []).length > 0
    && (state.questions || []).every((question) => question.status === 'completed')

  return (
    <div
      className={`assistant-panel ${open ? 'is-open' : ''}`}
      style={panelPosition ? { left: panelPosition.x, top: panelPosition.y, right: 'auto' } : undefined}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className={`assistant-trigger ${open ? 'active' : ''}`}
        onClick={() => update({ open: !open })}
      >
        AI
      </button>
      {open && (
        <div className="assistant-body">
          <strong className="assistant-title" onPointerDown={startPanelDrag}>
            {title} · 드래그 이동
          </strong>
          <div className="assistant-view-label">{viewLabel}</div>
          {(state.questions || []).map((question) => {
            const answering = state.activeQuestionId === question.id && question.status === 'answering'
            return (
              <section key={question.id} className={`assistant-question ${answering ? 'answering' : ''}`}>
                <div className="assistant-question-head">
                  <input
                    value={question.title}
                    onChange={(event) => updateQuestion(question.id, { title: event.target.value })}
                  />
                  <button
                    onClick={() => (answering ? completeAnswerMode(question.id) : startAnswerMode(question.id))}
                  >
                    {answering ? '답변완료' : '답변모드'}
                  </button>
                </div>
                <textarea
                  className="assistant-prompt"
                  value={question.prompt}
                  onChange={(event) => updateQuestion(question.id, { prompt: event.target.value })}
                />
                <textarea
                  placeholder="답변모드를 누른 뒤 이 질문에 대한 설명을 입력하세요."
                  value={question.answerText || ''}
                  onChange={(event) => updateQuestion(question.id, { answerText: event.target.value })}
                />
                <div className="assistant-question-meta">
                  <span>상태: {question.status === 'completed' ? '완료' : answering ? '답변 중' : '대기'}</span>
                  <span>마킹 {(question.marks || []).length}개</span>
                </div>
                <button className="assistant-link-button" onClick={() => clearQuestionMarks(question.id)}>
                  이 질문의 마킹 지우기
                </button>
              </section>
            )
          })}
          <div className="assistant-actions">
            <button onClick={addQuestion}>질문 추가</button>
            <button
              className="assistant-submit"
              disabled={!allCompleted || state.loading}
              onClick={onSubmit}
            >
              {state.loading ? '제출 중...' : '답변제출'}
            </button>
          </div>
          {state.error && <div className="assistant-error">{state.error}</div>}
          {state.resultPreview && (
            <div className="assistant-result">
              <strong>제안 결과</strong>
              <p>{state.resultPreview.summary}</p>
              {(state.resultPreview.actions || []).map((action, index) => (
                <div key={`${action.type}-${index}`}>- {action.label}</div>
              ))}
            </div>
          )}
          <p className="assistant-help">
            답변모드 중 화면에 표시한 선과 입력한 설명은 선택한 질문에 귀속됩니다.
          </p>
        </div>
      )}
      <style jsx>{`
        .assistant-panel {
          position: absolute;
          top: 12px;
          right: 96px;
          z-index: 12;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          color: #111827;
          font-size: 12px;
        }

        .assistant-trigger {
          min-width: 56px;
          border: 1px solid rgba(37, 99, 235, 0.8);
          border-radius: 999px;
          padding: 8px 13px;
          background: rgba(255, 255, 255, 0.94);
          color: #2563eb;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.16);
        }

        .assistant-trigger.active {
          background: #2563eb;
          color: #ffffff;
        }

        .assistant-body {
          width: 310px;
          max-height: 620px;
          overflow: auto;
          padding: 12px;
          border: 1px solid rgba(37, 99, 235, 0.35);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.18);
          backdrop-filter: blur(5px);
        }

        .assistant-title {
          display: block;
          margin-bottom: 4px;
          color: #1d4ed8;
          font-size: 14px;
          cursor: move;
          user-select: none;
        }

        .assistant-view-label {
          margin-bottom: 8px;
          color: #64748b;
          font-size: 11px;
          font-weight: 800;
        }

        .assistant-question {
          margin-top: 8px;
          padding: 8px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #ffffff;
        }

        .assistant-question.answering {
          border-color: #2563eb;
          background: rgba(37, 99, 235, 0.06);
        }

        .assistant-question-head,
        .assistant-actions,
        .assistant-question-meta {
          display: flex;
          gap: 6px;
          align-items: center;
          justify-content: space-between;
        }

        .assistant-question-head input {
          flex: 1;
        }

        .assistant-panel input,
        .assistant-panel textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          padding: 7px 8px;
          color: #111827;
          font-size: 12px;
          resize: vertical;
        }

        .assistant-prompt {
          min-height: 45px;
          margin-top: 6px;
        }

        .assistant-question textarea:not(.assistant-prompt) {
          min-height: 64px;
          margin-top: 6px;
        }

        .assistant-panel button {
          border: 1px solid #d1d5db;
          border-radius: 8px;
          padding: 7px 8px;
          background: #ffffff;
          color: #374151;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
        }

        .assistant-panel button:hover {
          border-color: #2563eb;
          color: #2563eb;
        }

        .assistant-submit {
          background: #2563eb !important;
          border-color: #2563eb !important;
          color: #ffffff !important;
        }

        .assistant-submit:disabled {
          background: #9ca3af !important;
          border-color: #9ca3af !important;
          cursor: not-allowed;
        }

        .assistant-link-button {
          margin-top: 6px;
          padding: 0 !important;
          border: 0 !important;
          color: #64748b !important;
          background: transparent !important;
          font-size: 11px !important;
        }

        .assistant-question-meta {
          margin-top: 6px;
          color: #64748b;
          font-size: 11px;
        }

        .assistant-actions {
          margin-top: 10px;
        }

        .assistant-error {
          margin-top: 8px;
          color: #dc2626;
          font-weight: 800;
        }

        .assistant-result {
          margin-top: 8px;
          padding: 8px;
          border-radius: 8px;
          background: rgba(37, 99, 235, 0.08);
          color: #1e3a8a;
          line-height: 1.45;
        }

        .assistant-result p {
          margin: 4px 0;
        }

        .assistant-help {
          margin: 8px 0 0;
          color: #64748b;
          font-size: 11px;
          line-height: 1.45;
        }
      `}</style>
    </div>
  )
}
