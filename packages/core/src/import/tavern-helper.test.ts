import { describe, expect, it } from "vitest";

import {
  inspectTavernHelperScripts,
  readTavernHelperBundle,
} from "./tavern-helper.js";

const inertScript = (id: string, enabled: boolean) => ({
  type: "script",
  enabled,
  name: `Clean-room fixture ${id}`,
  id,
  content: "/* intentionally inert clean-room fixture */",
  info: "",
  button: { enabled: false, buttons: [] },
  data: {},
  export_with: { data: true, button: true },
});

describe("Tavern Helper import inspection", () => {
  it("counts modern card scripts and folders without interpreting content", () => {
    expect(
      inspectTavernHelperScripts({
        data: {
          extensions: {
            tavern_helper: {
              scripts: [
                inertScript("one", true),
                {
                  type: "folder",
                  enabled: true,
                  name: "Fixture folder",
                  id: "folder",
                  icon: "folder",
                  color: "blue",
                  scripts: [
                    inertScript("two", false),
                    inertScript("three", true),
                  ],
                },
              ],
              variables: { fixture: "value" },
            },
          },
        },
      }),
    ).toEqual({
      present: true,
      sourcePath: "data.extensions.tavern_helper",
      treeCount: 2,
      scriptCount: 3,
      enabledScriptCount: 2,
      folderCount: 1,
      variableCount: 1,
      diagnostics: [],
    });
  });

  it("finds preset data retained beneath legacySource and accepts variales", () => {
    expect(
      inspectTavernHelperScripts({
        extensions: {
          legacySource: {
            extensions: {
              tavern_helper: {
                scripts: [inertScript("preset", false)],
                variales: { legacyTypo: true },
              },
            },
          },
        },
      }),
    ).toMatchObject({
      present: true,
      sourcePath: "extensions.legacySource.extensions.tavern_helper",
      scriptCount: 1,
      enabledScriptCount: 0,
      variableCount: 1,
      diagnostics: [],
    });
  });

  it("recognizes legacy character fields and reports malformed envelopes", () => {
    expect(
      inspectTavernHelperScripts({
        extensions: {
          TavernHelper_scripts: [inertScript("legacy", true)],
          TavernHelper_characterScriptVariables: {},
        },
      }),
    ).toMatchObject({
      sourcePath: "extensions.TavernHelper_scripts",
      scriptCount: 1,
      enabledScriptCount: 1,
    });
    expect(
      inspectTavernHelperScripts({
        extensions: { tavern_helper: "not-an-object" },
      }),
    ).toMatchObject({
      present: true,
      scriptCount: 0,
      diagnostics: ["The Tavern Helper envelope is not an object."],
    });
  });

  it("normalizes native runtime scripts, variables, folders, and quick actions", () => {
    const bundle = readTavernHelperBundle({
      extensions: {
        tavern_helper: {
          variables: { mode: "fixture" },
          scripts: [
            {
              type: "folder",
              id: "folder",
              name: "Fixture folder",
              enabled: false,
              scripts: [
                {
                  ...inertScript("nested", true),
                  content: "import 'https://example.invalid/fixture.js'",
                  info: "Clean-room fixture",
                  button: {
                    enabled: true,
                    buttons: [
                      { name: "Run fixture", visible: true },
                      { name: "Hidden fixture", visible: false },
                    ],
                  },
                  data: { count: 1 },
                },
              ],
            },
            {
              ...inertScript("direct", true),
              button: {
                enabled: true,
                buttons: [{ name: "Direct action", visible: true }],
              },
            },
          ],
        },
      },
    });

    expect(bundle).toEqual({
      present: true,
      sourcePath: "extensions.tavern_helper",
      variables: { mode: "fixture" },
      diagnostics: [],
      scripts: [
        {
          id: "nested",
          name: "Clean-room fixture nested",
          content: "import 'https://example.invalid/fixture.js'",
          info: "Clean-room fixture",
          declaredEnabled: true,
          enabled: false,
          buttonEnabled: true,
          buttons: [
            { id: "nested:0", name: "Run fixture", visible: true },
            { id: "nested:1", name: "Hidden fixture", visible: false },
          ],
          data: { count: 1 },
          treeId: "folder",
          treeName: "Fixture folder",
          sourcePath: "extensions.tavern_helper.scripts.0.scripts.0",
        },
        {
          id: "direct",
          name: "Clean-room fixture direct",
          content: "/* intentionally inert clean-room fixture */",
          info: "",
          declaredEnabled: true,
          enabled: true,
          buttonEnabled: true,
          buttons: [{ id: "direct:0", name: "Direct action", visible: true }],
          data: {},
          sourcePath: "extensions.tavern_helper.scripts.1",
        },
      ],
    });
  });

  it("keeps malformed runtime fields inert and reports diagnostics", () => {
    expect(
      readTavernHelperBundle({
        extensions: {
          tavern_helper: {
            scripts: [
              {
                id: "malformed",
                name: "Malformed fixture",
                button: {
                  enabled: true,
                  buttons: ["invalid", { name: "", visible: true }],
                },
              },
            ],
            variables: [],
          },
        },
      }),
    ).toMatchObject({
      scripts: [
        {
          id: "malformed",
          enabled: true,
          buttons: [],
          data: {},
        },
      ],
      variables: {},
      diagnostics: [
        "Tavern Helper script 'malformed' has an invalid button at index 0.",
        "Tavern Helper script 'malformed' has an unnamed button at index 1.",
        "The Tavern Helper variables field is not an object.",
      ],
    });
  });
});
