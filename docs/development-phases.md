# FAM 개발 문서 - Phase 1 / Phase 2 / Phase3

## 개요

FAM은 지번 또는 주소를 입력하면 분석 대상 대지를 찾고, 건축 규제와 모델링 정보를 연결해 3D로 검토하는 건축 초기 검토 도구입니다.

현재 프로젝트는 크게 세 단계로 나눌 수 있습니다.

- Phase 1: 지번 입력 기반 MVP. 대지와 단순 건축가능 체적을 생성하고 웹 3D 뷰어에서 확인하는 단계.
- Phase 2: 실제 필지/규제/평면/건축개요를 연결해 건축규제 자동검색을 고도화한 단계.
- Phase3: 규제 기반 3D 설계 편집 MVP. 층별 그리드 평면 편집, 3D 모델 반영, 저장/불러오기를 연결하는 현재 단계.

## Phase 1

### 목표

Phase 1의 목표는 주소 입력부터 3D 모델 표시까지의 최소 동작 흐름을 만드는 것이었습니다.

핵심 흐름:

1. 사용자가 지번 또는 주소를 입력한다.
2. 백엔드가 대지 좌표를 생성하거나 조회한다.
3. 대지와 건축가능 체적을 단순 3D 모델로 만든다.
4. GLB 파일로 export한다.
5. 프론트엔드 3D 뷰어에서 모델을 표시한다.

### 주요 기능

- 지번 입력 UI
- FastAPI 기반 `/generate` API
- 대지 polygon 생성
- `trimesh` 기반 3D mesh 생성
- GLB export
- Next.js + React Three Fiber 기반 3D 뷰어
- 기본 OrbitControls

### 주요 파일

- `apps/api/main.py`
  - FastAPI 앱과 `/generate` 엔드포인트 정의

- `engine/pipeline.py`
  - 주소 입력부터 모델 생성, GLB export, API 응답 생성까지의 메인 파이프라인

- `engine/geometry/site_generator.py`
  - 분석 대상 대지와 주변 요소 생성

- `engine/geometry/envelope_generator.py`
  - 건축가능 체적 생성

- `engine/export/glb_exporter.py`
  - 생성된 mesh를 GLB 파일로 저장하고 URL 반환

- `apps/web/app/page.jsx`
  - 주소 입력, API 호출, 상태 관리

- `apps/web/components/Viewer.jsx`
  - GLB 모델 표시와 3D 뷰어 구성

### Phase 1 한계

- 실제 필지 경계와 지목 표현이 제한적이었다.
- 주변 필지/도로/경계선 표현이 단순했다.
- 건폐율/용적률 등의 규제값이 실제 데이터와 충분히 연결되지 않았다.
- 층별 매스, 평면도, 건축개요 등의 설계 검토 UI가 없었다.
- 모델링 결과가 법규 초과 여부와 실시간으로 연결되지 않았다.

## Phase 2

### 목표

Phase 2의 목표는 실제 필지 데이터, 규제 분석, 모델 설정, 층별 평면, 건축개요를 연결해 설계 초기 검토에 사용할 수 있는 도구로 확장하는 것입니다.

Phase 2는 다음 방향으로 발전했습니다.

- 실제 필지 경계 기반 모델링
- 지목별 색상 표현
- 도로 필지와 일반 필지의 시각적 분리
- CAD처럼 일정 두께로 보이는 경계선
- 층별 매스 및 평면도 표시
- 모델 설정 기반 층고/용도/구조/주차/조경 입력
- 건축개요 자동 계산
- 건폐율/용적률 초과 경고
- 규제값 수정 후 모델링 반영

## Phase3: 규제 기반 3D 설계 편집 MVP

### 목표

Phase3의 목표는 규제 분석 결과를 바탕으로 사용자가 층별 평면을 직접 편집하고, 그 결과를 3D 모델과 저장 상태에 반영하는 것입니다.

현재 Phase3는 다음 기능을 중심으로 발전하고 있습니다.

- 그리드 기반 층별 평면 편집
- 전층 적용 및 상부층 일괄 반영
- CORE, 화장실, 복도, 주차장, 조경 등 세부 용도 표현
- 편집된 평면의 3D 모델 반영
- 아래층 외곽선 참고 표시
- 모델 저장, 불러오기, 삭제
- 모델 설정 변경 시 기존 편집 상태 보존

## Phase3 데이터 흐름

### 1. 주소 입력

프론트엔드에서 사용자가 주소 또는 지번을 입력합니다.

관련 파일:

- `apps/web/app/page.jsx`

API 요청 예:

```json
{
  "address": "서울특별시 종로구 익선동 82",
  "modelSettings": {},
  "regulationOverrides": {}
}
```

### 2. 필지 및 토지 정보 조회

백엔드는 VWorld API를 통해 다음 정보를 조회합니다.

- 주소 검색
- 필지 좌표
- PNU
- 토지특성
- 토지이용계획
- 주변 필지
- 지목
- 도로 여부

관련 파일:

- `services/gis/vworld_client.py`
- `services/gis/parcel_fetcher.py`
- `services/gis/geo_utils.py`

### 3. 주소정보누리집 주소 조회

대지위치 표기를 위해 주소정보누리집 도로명주소 API를 선택적으로 연결했습니다.

관련 파일:

- `services/gis/juso_client.py`
- `services/gis/parcel_fetcher.py`

환경변수:

```env
JUSO_API_KEY=주소정보누리집_도로명주소_API_승인키
```

현재 동작:

- `JUSO_API_KEY`가 있으면 주소정보누리집 API로 지번주소와 도로명주소를 조회합니다.
- 키가 없으면 VWorld 검색 결과를 fallback으로 사용합니다.

참고:

- [주소정보누리집](https://www.juso.go.kr/)

### 4. 규제 분석

토지특성의 용도지역 정보를 기반으로 건폐율/용적률을 산정합니다.

관련 파일:

- `engine/regulation/regulation_engine.py`
- `engine/regulation/rules.py`

현재 특징:

- 용도지역 alias 매칭
- 법정 건폐율/용적률 기본값 산정
- 대지면적 기준 최대 건축면적/최대 연면적 계산
- 사용자가 건폐율/용적률을 수정하면 모델링에 반영

### 5. 모델 생성

규제값과 모델 설정을 바탕으로 지상층/지하층 매스를 생성합니다.

관련 파일:

- `engine/geometry/envelope_generator.py`
- `engine/pipeline.py`

현재 반영 사항:

- 모델링 바닥면적은 최대 건축면적을 초과하지 않도록 제한
- 건폐율 입력값이 과도해도 대지 내부로 clipping
- 지상층/지하층 층고 설정
- 층별 용도 설정
- 구조, 주차, 조경 등 건축개요 입력값 유지
- 층별 평면도용 footprint 데이터 반환

### 6. 프론트엔드 표시

프론트엔드는 API 응답을 받아 3D 모델, 필지면, 경계선, 평면도, 건축개요를 표시합니다.

관련 파일:

- `apps/web/app/page.jsx`
- `apps/web/components/Viewer.jsx`
- `apps/web/components/RegulationPanel.jsx`

## Phase3 주요 기능

### 필지 색상 및 지목 처리

지목 코드에 따라 필지 색상을 다르게 적용합니다.

주요 정책:

- `도` 또는 도로로 판정되는 필지는 회색
- 도로 필지 사이의 경계선은 표시하지 않음
- 지목 목록에 없는 필지는 흰색
- 분석 대상 대지도 지목 색상 적용

관련 파일:

- `services/gis/parcel_fetcher.py`
- `engine/geometry/site_generator.py`
- `apps/web/components/Viewer.jsx`

### CAD 스타일 경계선

초기에는 3D mesh로 경계선을 만들었으나, 현재는 프론트에서 `Line`으로 렌더링합니다.

목적:

- 확대/축소해도 일정한 선 두께 유지
- 분석 대상 경계선 우선 표시
- 도로 외 필지 경계 중복 제거
- 도로 필지 상호 경계 미표시

관련 파일:

- `engine/geometry/site_generator.py`
- `apps/web/components/Viewer.jsx`

### 층별 매스 및 평면도

모델 설정을 통해 지상층과 지하층 정보를 구성합니다.

현재 기능:

- 지상층 추가/삭제
- 지상층 층고 입력
- 지상층 용도 입력
- 지하층 수 입력
- 지하층 층고/용도 입력
- 지상 1층 평면도에 필지 표시
- 평면도 비율 왜곡 방지
- 평면도 회전/이동/줌 조정

평면도 조작:

- 회전: `Shift + 휠`
- 이동: 드래그
- 줌: `Alt + 휠`
- 초기화/확인 버튼으로 조정값 관리

관련 파일:

- `engine/geometry/envelope_generator.py`
- `apps/web/components/Viewer.jsx`
- `apps/web/app/page.jsx`

### 건축개요

모델링 영역 좌측 상단에 건축개요를 표시합니다.

현재 표시 항목:

- 대지위치
  - 지번주소
  - 도로명주소
- 건축면적
- 연면적
- 연면적_용
- 건폐율
- 용적률
- 구조
- 규모
- 주차장
- 조경면적
- 최고높이

자동 계산 항목:

- 건축면적: 지상층 평면의 최대 수평투영면적
- 연면적: 지상층 + 지하층 바닥면적 합계
- 연면적_용: 지상층 바닥면적 합계
- 건폐율: 건축면적 / 대지면적
- 용적률: 지상층 바닥면적 합계 / 대지면적
- 규모: 지하층/지상층 수
- 최고높이: 지상층 층고 합산

수동/설정 입력 항목:

- 구조
- 주차 총 대수
- 조경 설치면적
- 법정 조경면적

관련 파일:

- `apps/web/components/Viewer.jsx`
- `apps/web/app/page.jsx`

### 건축면적/연면적 초과 경고

모델링 영역 우측 상단에 초과 경고를 표시합니다.

현재 경고:

- 건축면적 초과
- 최대 연면적 초과

표현:

- 빨간색 점멸 문구
- 서로 겹치지 않도록 세로 배치

관련 파일:

- `apps/web/components/Viewer.jsx`

### 건축규제 분석 패널

우측 규제 패널에서 법정 규모 정보를 표시합니다.

현재 기능:

- 검색 지번
- PNU
- 형상 출처
- 대지면적
- 용도지역
- 건폐율
- 용적률
- 최대 건축면적
- 최대 연면적
- 지목
- 도로접면
- 규제값 수동 수정
- `모델링에 반영` 버튼

관련 파일:

- `apps/web/components/RegulationPanel.jsx`
- `apps/web/app/page.jsx`
- `engine/pipeline.py`

## 현재 환경 변수

```env
VWORLD_API_KEY=발급받은_VWorld_인증키
VWORLD_DOMAIN=http://localhost:3000

# 선택 사항
JUSO_API_KEY=주소정보누리집_도로명주소_API_승인키

# API 없이 UI만 확인할 때
FAM_DEMO_MODE=true
```

## 현재 API 응답 주요 필드

`POST /generate`

```json
{
  "success": true,
  "modelUrl": "http://localhost:8002/static/models/example.glb",
  "parcel": {
    "address": "지번주소",
    "road_address": "도로명주소",
    "pnu": "PNU",
    "area_m2": 0
  },
  "regulations": {},
  "modelSettings": {},
  "floorPlans": [],
  "parcelSurfaces": [],
  "boundaryLines": {}
}
```

## 현재 포트

- Frontend: `http://localhost:3000`
- Backend: `http://127.0.0.1:8002`

## 검증 방법

### 백엔드 문법 검사

```bash
python -m compileall services engine apps/api
```

### 프론트 빌드

```bash
cd apps/web
npx next build
```

참고:

- 현재 Next.js 빌드 중 SWC lockfile patch 경고가 표시되지만, 컴파일은 성공합니다.
- 필요 시 `apps/web`에서 의존성 재설치를 통해 lockfile 경고를 정리할 수 있습니다.

## Phase3 남은 과제

### 우선순위 높음

- 층별 매스 직접 편집
  - 층별 크기 조정
  - 층별 이동
  - 층별 회전
  - 편집 결과를 3D 모델/평면도/건축개요에 즉시 반영

- 대지 내부 제한 검증
  - 대지경계 밖 돌출 체크
  - 최대 건축면적 초과 체크
  - 최대 연면적 초과 체크
  - 최고높이 초과 체크

- 대지안의 공지 반영
  - 이격거리 산정
  - 이격 가능 영역 표시
  - 매스가 이격선 밖으로 나갈 때 경고

### 중간 우선순위

- 일조사선 분석
  - 정북방향 기준 판단
  - 경계선 기준 사선면 생성
  - 초과 구간 표시

- 그림자 분석
  - 날짜/시간 입력
  - 태양 고도/방위각 계산
  - 그림자 표시/숨김

- 주변 건물 매스
  - 건물통합정보 기반 footprint + 높이 매스화
  - 주변건물 보이기/없애기 토글

### 후속 검토

- VWorld LoD4 3차원 입체모형 연동
  - 정밀 모델 표시 품질은 높으나 데이터 형식/성능/좌표 정합 확인 필요
  - 현재 프로젝트의 GLB/Three.js 파이프라인과 직접 호환되는지 별도 검토 필요

## 설계 원칙

- 먼저 분석대지 내부 모델링을 고도화한다.
- 외부 건물/그림자/LoD4는 내부 모델링이 안정된 뒤 단계적으로 붙인다.
- 법규 검토와 시각화는 구분한다.
- 편집 결과는 항상 건축개요와 경고 UI에 즉시 반영되도록 한다.
- API 키가 없는 외부 서비스는 fallback 동작을 유지한다.
