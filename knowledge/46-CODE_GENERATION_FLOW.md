# Code Generation Flow

## Purpose

Sprint 22 introduces a new functional agent that turns a technically approved
`TechnicalSpecification` into an immutable bundle of textual source files. It produces data only;
it cannot write or execute files.

## Generation pipeline

```mermaid
flowchart TD
    Source["Approved TechnicalSpecification"] --> Request["CodeGenerationRequest"]
    Request --> SourceGate["Approval, hash, CREATE-only and module-path eligibility"]
    SourceGate --> Knowledge["Knowledge Loader: CODE_GENERATOR"]
    Knowledge --> Projection["Untrusted input projection"]
    Projection --> Runner["Agent Runner"]
    Runner --> Prompt["Prompt Builder"]
    Runner --> Provider["AI Provider interface"]
    Provider --> Response["Untrusted structured response"]
    Response --> Validator["Response Validator"]
    Validator --> Business["Code Business Validation"]
    Business --> Assembler["Deterministic Bundle Assembler"]
    Assembler --> Bundle["GeneratedCodeBundle"]
```

## Trust boundaries

```mermaid
flowchart LR
    subgraph Trusted["Trusted server configuration"]
        Assets["Versioned prompt assets"]
        Policy["Code generation policy"]
        Approval["Application-projected approval evidence"]
    end

    subgraph Untrusted["Untrusted content"]
        Spec["TechnicalSpecification content"]
        Knowledge["Knowledge documents"]
        Model["Model response"]
        Code["Generated source text"]
    end

    Assets --> Generator["Code Generator"]
    Policy --> Generator
    Approval --> Generator
    Spec --> Generator
    Knowledge --> Generator
    Model --> Generator
    Generator --> Code
    Code --> Note["Validated data, never execution authority"]
```

## Generated bundle

```mermaid
classDiagram
    class GeneratedCodeBundle {
      contractVersion
      technicalSpecificationHash
      bundleHash
      generationHash
    }
    class GeneratedCodeManifest {
      fileCount
      totalBytes
      entrypoints
      manifestHash
    }
    class GeneratedCodeFile {
      path
      content
      encoding UTF-8
      mediaType
      purpose
      sourceModuleIds
      sourcePlanItemIds
      byteLength
      contentHash
      fileHash
    }
    GeneratedCodeBundle *-- GeneratedCodeManifest
    GeneratedCodeBundle *-- "1..96" GeneratedCodeFile
```

## Validation and failure flow

```mermaid
flowchart TD
    Input["Raw input"] --> RequestValidation{"Request valid?"}
    RequestValidation -- "No" --> TechnicalError["Canonical technical error"]
    RequestValidation -- "Yes" --> Approval{"Approved, matching and materializable source?"}
    Approval -- "No" --> TechnicalError
    Approval -- "Yes" --> Run["One Agent Runner call"]
    Run --> Structural{"Response Validator accepted?"}
    Structural -- "No" --> Rejected["VALIDATION_REJECTED / RESPONSE_VALIDATION"]
    Structural -- "Yes" --> Semantic{"Business Validation accepted?"}
    Semantic -- "No" --> BusinessRejected["VALIDATION_REJECTED / BUSINESS_VALIDATION"]
    Semantic -- "Yes" --> Generated["GENERATED with immutable bundle"]
```

There is no retry, partial bundle, hidden correction or truncation. A rejected result contains no
materializable bundle.

## Hash chain

```mermaid
flowchart LR
    Specification["TechnicalSpecificationHash"] --> Response["ResponseHash"]
    Specification --> BundleContent["BundleContentHash"]
    BundleContent --> Bundle["BundleHash"]
    Response --> Generation["GenerationHash"]
    Bundle --> Generation
    Generation --> WorkspacePlan["Future WorkspacePlan projection"]
```

Hashes verify deterministic integrity and correlation. They are not signatures and do not prove
authenticity.

## Boundary with the workflow

```mermaid
flowchart LR
    Workflow["Existing PO → Developer → QA workflow"] --> Result["Successful ExecutionResult in memory"]
    Result -. "Future trusted application integration" .-> Handoff["CodeGenerationRequest"]
    Handoff --> CodeGenerator["Code Generator"]

    ExistingRepository["Execution Repository"] -. "hashes only" .-> Blocked["Cannot reconstruct TechnicalSpecification"]
```

Sprint 22 exposes the capability programmatically but does not add it to the existing workflow,
HTTP API or Factory View.
