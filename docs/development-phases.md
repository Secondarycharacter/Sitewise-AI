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

## 개발노트: 법규 엔진 및 지구단위계획 첨부문서 분석 고도화

최근 Phase3는 단순 용도지역 fallback 기준을 넘어, 실제 법규 원문/별표/토지이음/지구단위계획 문서를 함께 확인하는 방향으로 확장되었습니다.

### 법제처 Open API / 조례 / 별표 색인

법제처 Open API를 직접 활용하는 provider 구조를 추가했습니다.

구현 범위:

- 법령/자치법규/별표 검색을 위한 공통 provider 인터페이스
- 관할 지자체 추정
- 법령/조례 본문 문서 파싱
- 별표 후보 검색 및 색인
- 본문 조문과 별표 참조 연결
- 문서 캐시 저장
- 규제 패널에서 본문/별표 색인 상태 표시

주요 파일:

- `engine/regulation/law_provider.py`
- `engine/regulation/law_openapi_client.py`
- `engine/regulation/law_document.py`
- `engine/regulation/law_document_store.py`
- `engine/regulation/law_document_search.py`
- `engine/regulation/article_appendix_linker.py`
- `engine/regulation/law_appendix_downloader.py`

정리:

- 법규 검토 흐름은 "본문 확인 후 관련 별표 확인"을 기준으로 설계합니다.
- 별표는 실무 계산식이 들어 있는 경우가 많으므로, 본문 조항과의 연결 상태를 별도로 추적합니다.
- Open API로 직접 얻기 어려운 별표 본문은 국가법령정보센터 웹 경로를 통한 fallback 다운로드 구조를 둡니다.

### 주차 산정 엔진

서울시 주차장 조례 별표 2를 기준 사례로, 부설주차장 설치기준을 구조화하는 초기 엔진을 추가했습니다.

구현 범위:

- 주택계/오피스텔/복합용도 주차 산정을 위해 `buildingProgram` 건축개요 데이터 모델 초안 추가
- 층별 용도/면적 또는 향후 입력될 `buildingProgram.areaComponents`를 바탕으로 일반건축물, 오피스텔, 상가주택, 다가구주택, 공동주택/아파트, 주상복합/복합주거를 1차 분류
- 전용면적, 공용면적, 주차면적, 기계/전기/코어 등 공용 성격 면적을 구분하고 공용면적 배분 후보를 생성
- 주택/오피스텔은 세대·호실별 전용면적 입력이 없으면 주차 산정을 `needs_input` 대상으로 분류
- 모델 설정과 분리된 `건축개요` 전용 화면을 추가하고, 첨부된 일반건축물 개요 XLS의 좌측 설계개요/우측 층별 용도개요 구조를 웹 표로 재현
- 내부 건축개요 데이터는 세움터 입력 항목과 가장 가까운 `국토교통부_건축HUB_건축인허가정보 서비스` 구조를 기준으로 `buildingPermitOverview` 초안 스키마를 추가
- `buildingPermitOverview`는 기본개요, 대지위치, 지역지구구역, 동별개요, 층별개요, 호별개요, 전유/공용면적, 주차장/부설주차장 섹션으로 구성
- 각 섹션은 건축HUB 필드명(`platPlc`, `sigunguCd`, `bjdongCd`, `platArea`, `archArea`, `totArea`, `vlRatEstmTotArea`, `flrNoNm`, `mainPurpsCdNm` 등)과 한글 라벨을 함께 저장
- 실제 세움터 스크린샷을 참고해 건축개요 화면을 `대지조건`, `전체개요`, `준주택/도시형 생활주택 개요`, `동별개요`, `층별개요`, `주차장`, `공적공간`, `호(실)/가구별 면적`의 접이식 섹션형 UI로 재구성
- 층별 용도와 면적은 3D 모델링 결과(`floorPlans`)와 건축규제 분석값을 기반으로 자동 기입하고, 구조/계획 주차대수/조경 계획값만 별도 보정 가능하도록 구성
- 현재 동작을 빠르게 검증할 수 있도록 오피스텔+근생, 상가주택, 주상복합 건축개요 테스트 프리셋을 `건축개요` 화면으로 이동
- 사용자가 개요 유형을 명시하면 자동 추론보다 우선 적용하고, RegulationPanel에서도 건축개요/면적 구성 및 누락 입력을 요약 표시
- 주택/오피스텔처럼 조례 별표가 `주택건설기준 등에 관한 규정` 등 외부 기준을 참조하는 경우, 잘못 0대로 합산하지 않고 세대·전용면적 입력 상태와 미해결 기준을 별도 행으로 표시
- `건축법 시행령 별표 1` 건축물 용도 분류를 기준으로 층별 입력 용도를 먼저 정규화
- 법정 용도 대분류, 세부용도, 주차 산정용 매핑 카테고리를 주차 입력값에 함께 저장
- 법제처/별표 원문 수집 흐름에 `건축법 시행령 건축물의 용도` 검색을 추가하고, 수집된 별표 1 텍스트를 구조화하는 파서 초안을 추가
- 법제처 검색 결과가 여러 개일 때 목적별 후보 랭킹을 적용해 `건축법 시행령 [별표 1] 용도별 건축물의 종류`와 `주차장 설치 및 관리 조례 [별표 2] 부설주차장 설치기준`을 우선 선택
- 별표 1 원문을 수집하지 못한 경우에는 seed taxonomy를 후보 매칭에만 사용하되 `seed-fallback` 및 비권위 상태로 명시
- 주차 산정은 법제처 원문 기반 용도 taxonomy가 있을 때만 용도분류 근거를 authoritative하게 취급하고, API 미확인 상태에서는 수동확인을 유지
- 별표 텍스트에서 시설별 주차 산정 기준 추출
- `시설면적 n㎡당 1대` 유형의 계산식 파싱
- 한 시설 행 안에 여러 세부 기준이 있는 경우(일반업무/공공업무, 학교/기숙사/그 밖의 건축물) 세부 기준 후보를 분리
- 층별 평면 용도/면적을 주차 산정 입력값으로 정규화
- 근린생활시설, 판매시설, 업무시설 등 유사 용도 간 매칭 우선순위 보정
- 오피스텔처럼 건축법 시행령상 업무시설이지만 주차 조례에서는 별도 주택 기준 항목으로 산정되는 용도를 분리
- 복합용도 산정 시 용도별 산정값을 소수점 이하 첫째자리까지 반영한 뒤 합산
- 계획 주차대수와 법정 필요대수 비교
- 계획대수가 필요대수 이상이어도 별표 파싱 근거가 초안이면 체크리스트를 수동확인 상태로 유지
- 주차장 설치제한구역, 장애인전용주차구획 등은 별도 확인 항목으로 분리

주요 파일:

- `engine/regulation/parking_rule_parser.py`
- `engine/regulation/building_program_model.py`
- `engine/regulation/building_use_classifier.py`
- `engine/regulation/building_use_appendix_parser.py`
- `engine/regulation/parking_area_model.py`
- `engine/regulation/parking_calculator.py`
- `engine/regulation/parking_exception_engine.py`
- `engine/regulation/accessible_parking_engine.py`

정리:

- 주차대수 산정은 조례 별표에 크게 의존합니다.
- 설치제한구역, 장애인/전기차/경형/친환경 등은 별도 엔진 또는 수동 옵션으로 분리하는 방향이 적합합니다.

### 토지이음 / 지구단위계획 감지

토지이음 및 공공데이터포털 토지이용규제정보서비스를 염두에 둔 EUM 컨텍스트를 추가했습니다.

구현 범위:

- PNU 기반 토지이용규제정보서비스 조회 준비
- API 키가 없을 때 parcel/zone 데이터 기반 fallback
- 지역·지구 후보 정규화
- 지구단위계획구역 감지
- 지구단위계획이 건폐율/용적률/높이 기준을 바꿀 수 있음을 규제 패널과 체크리스트에 표시

주요 파일:

- `engine/regulation/eum_client.py`
- `engine/regulation/eum_engine.py`
- `engine/regulation/district_plan_engine.py`

정리:

- 지구단위계획구역은 감지 단계와 실제 수치 적용 단계를 분리합니다.
- 실제 수치 적용은 결정도서/시행지침 확인 후 사용자가 최종값을 수동 입력하는 방식이 현실적입니다.

### 지구단위계획 결정도서/시행지침 첨부문서 분석

지구단위계획 결정도서/시행지침은 전산화되어 있지 않은 PDF/JPG 문서인 경우가 많으므로, 문서 업로드 기반 분석 흐름을 추가했습니다.

구현 범위:

- PDF/JPG/PNG/WEBP/TXT/HTML/MD 업로드
- 문서 원본과 분석 JSON을 `.fam-cache/district_plan_documents`에 저장
- 대지별 최근 분석 이력 조회
- 텍스트/HTML 즉시 분석
- 텍스트 레이어가 있는 PDF의 제한적 텍스트 추출
- 이미지/스캔 PDF는 OCR 어댑터를 통해 분석 시도
- 건폐율/용적률/높이/층수/용도/한계선/인센티브 관련 문구 요약
- 규제 패널에 최근 분석 이력과 요약 카드 표시

주요 파일:

- `apps/web/app/api/district-plan/analyze/route.js`
- `apps/web/lib/districtPlanDocumentAnalysis.js`
- `apps/web/lib/ocrAdapter.js`
- `apps/web/components/RegulationPanel.jsx`

중요한 정책:

- 첨부문서 분석은 자동 산정/자동 적용이 아니라 요약 보조 기능입니다.
- 건폐율, 용적률, 높이의 최종 적용값은 사용자가 수동 입력합니다.
- 인센티브표는 공개공지, 권장용도, 공공기여 등 계획 조건과 맞물려 자동 산정하지 않습니다.
- 인센티브표/완화/상한 관련 문구는 별도 요약 후보로만 표시합니다.

현재 OCR 상태:

- `FAM_OCR_PROVIDER=local-tesseract` 설정 시 로컬 Tesseract OCR을 사용할 수 있습니다.
- 스캔 PDF는 Poppler `pdftoppm`으로 페이지 이미지를 만든 후 OCR합니다.
- 현재 개발 환경에서는 `tesseract`, `pdftoppm`이 PATH에서 발견되지 않았으므로 실제 OCR은 도구 설치 후 테스트가 필요합니다.

### 수동 입력 기준값 반영

지구단위계획 문서 요약 후보를 참고해 사용자가 직접 입력한 값을 모델링에 반영하는 흐름을 정리했습니다.

현재 수동 입력 항목:

- 건폐율
- 용적률
- 높이 제한

동작:

- 첨부문서 요약 카드의 후보값을 수동 입력란에 채울 수 있습니다.
- 최종 반영은 사용자가 `모델링에 반영` 버튼을 눌러 수행합니다.
- 백엔드 파이프라인은 `regulationOverrides.maxHeightM` 값을 `limits.max_height_m`에 반영합니다.
- 모델 생성 시 높이 제한은 매스 생성 높이에 반영됩니다.
- 자동 체크리스트에 `높이 제한` 항목이 추가됩니다.

관련 파일:

- `apps/web/app/page.jsx`
- `apps/web/components/RegulationPanel.jsx`
- `engine/pipeline.py`
- `engine/regulation/site_compliance_engine.py`
- `engine/regulation/compliance_evidence_planner.py`

### 대지별 자동 법규 체크리스트

수동 질문 기반 QA가 아니라, 대지/계획/법규 데이터로 필요한 검토 항목을 자동 생성하는 방식으로 전환했습니다.

현재 체크 항목:

- 토지이용/행위제한
- 법규 원문/별표 근거
- 건폐율
- 용적률
- 높이 제한
- 지구단위계획 규모 보정 필요 여부
- 부설주차장 필요대수
- 주차장 설치제한구역/예외
- 장애인전용주차구획
- 조경 의무
- 대지안의 공지

주요 파일:

- `engine/regulation/site_compliance_engine.py`
- `engine/regulation/compliance_evidence_planner.py`

정리:

- 자동 확정 가능한 항목은 `pass/fail`로 표시합니다.
- 원문 대조, 별표 확인, 수동 입력이 필요한 항목은 `needs_review`, `needs_input`, `data_missing`으로 분리합니다.
- 지구단위계획 첨부문서 분석 결과는 자동 확정값이 아니라 수동 입력을 돕는 근거 자료로 다룹니다.

## 현재 환경 변수

```env
VWORLD_API_KEY=발급받은_VWorld_인증키
VWORLD_DOMAIN=http://localhost:3000

# Korean Law Open API / 법제처
LAW_OC=법제처_Open_API_OC

# 토지이음/토지이용규제정보서비스
EUM_SERVICE_KEY=공공데이터포털_서비스키
# EUM_LAND_USE_RESTRICTION_URL=http://apis.data.go.kr/...

# 지구단위계획 첨부문서 OCR
# FAM_OCR_PROVIDER=local-tesseract
# TESSERACT_CMD=tesseract
# PDF_TO_IMAGE_CMD=pdftoppm
# FAM_OCR_LANG=kor+eng
# FAM_OCR_TIMEOUT_MS=30000
# FAM_OCR_PDF_DPI=200
# FAM_OCR_PDF_MAX_PAGES=5
# FAM_OCR_PDF_CONVERT_TIMEOUT_MS=30000

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
