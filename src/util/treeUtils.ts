import { Position } from "vscode-languageserver";
import { SyntaxNode, Tree } from "web-tree-sitter";
import { IImport, IImports } from "../imports";
import { IForest } from "../forest";
import { Utils } from "./utils";
import { comparePosition } from "../positionUtil";

export type NodeType =
  | "Function"
  | "FunctionParameter"
  | "TypeAlias"
  | "Type"
  | "Operator"
  | "Module"
  | "CasePattern"
  | "AnonymousFunctionParameter"
  | "UnionConstructor"
  | "FieldType"
  | "TypeVariable";

const functionNameRegex = new RegExp("[a-zA-Z0-9_]+");

export interface IExposing {
  name: string;
  syntaxNode: SyntaxNode;
  type: NodeType;
  exposedUnionConstructors?: {
    name: string;
    syntaxNode: SyntaxNode;
    accessibleWithoutPrefix: boolean;
  }[];
}

function flatMap<T, U>(
  array: T[],
  callback: (value: T, index: number, array: T[]) => U[],
): U[] {
  const flattend: U[] = [];
  for (let i = 0; i < array.length; i++) {
    const elementArray = callback(array[i], i, array);
    for (const el of elementArray) {
      flattend.push(el);
    }
  }
  return flattend;
}

export class TreeUtils {
  public static getModuleNameNode(tree: Tree): SyntaxNode | undefined {
    const moduleDeclaration:
      | SyntaxNode
      | undefined = this.findModuleDeclaration(tree);
    if (moduleDeclaration) {
      return this.findFirstNamedChildOfType(
        "upper_case_qid",
        moduleDeclaration,
      );
    }
  }

  public static getModuleExposingListNodes(tree: Tree): SyntaxNode[] {
    const moduleNode = TreeUtils.findModuleDeclaration(tree);

    if (moduleNode) {
      return [
        ...TreeUtils.descendantsOfType(moduleNode, "exposed_value"),
        ...TreeUtils.descendantsOfType(moduleNode, "exposed_type"),
      ];
    }

    return [];
  }

  public static getModuleNameAndExposing(
    tree: Tree,
  ): { moduleName: string; exposing: IExposing[] } | undefined {
    const moduleDeclaration:
      | SyntaxNode
      | undefined = this.findModuleDeclaration(tree);
    if (moduleDeclaration) {
      const moduleName = this.findFirstNamedChildOfType(
        "upper_case_qid",
        moduleDeclaration,
      );

      const exposingList = this.findFirstNamedChildOfType(
        "exposing_list",
        moduleDeclaration,
      );
      if (exposingList) {
        const exposed: IExposing[] = [];
        if (TreeUtils.findFirstNamedChildOfType("double_dot", exposingList)) {
          if (moduleName) {
            const functions = TreeUtils.descendantsOfType(
              tree.rootNode,
              "value_declaration",
            );
            if (functions) {
              functions.forEach((elmFunction) => {
                const declaration = TreeUtils.findFirstNamedChildOfType(
                  "function_declaration_left",
                  elmFunction,
                );
                if (declaration && declaration.firstNamedChild) {
                  const functionName = declaration.firstNamedChild.text;
                  exposed.push({
                    exposedUnionConstructors: undefined,
                    name: functionName,
                    syntaxNode: declaration,
                    type: "Function",
                  });
                }
              });
            }

            const typeAliases = this.findAllTypeAliasDeclarations(tree);
            if (typeAliases) {
              typeAliases.forEach((typeAlias) => {
                const name = TreeUtils.findFirstNamedChildOfType(
                  "upper_case_identifier",
                  typeAlias,
                );
                if (name) {
                  exposed.push({
                    exposedUnionConstructors: undefined,
                    name: name.text,
                    syntaxNode: typeAlias,
                    type: "TypeAlias",
                  });
                }
              });
            }

            const typeDeclarations = this.findAllTypeDeclarations(tree);
            if (typeDeclarations) {
              typeDeclarations.forEach((typeDeclaration) => {
                const unionConstructors: {
                  name: string;
                  syntaxNode: SyntaxNode;
                  accessibleWithoutPrefix: boolean;
                }[] = [];
                TreeUtils.descendantsOfType(
                  typeDeclaration,
                  "union_variant",
                ).forEach((variant) => {
                  const name = TreeUtils.findFirstNamedChildOfType(
                    "upper_case_identifier",
                    variant,
                  );
                  if (name && name.parent) {
                    unionConstructors.push({
                      accessibleWithoutPrefix: false,
                      name: name.text,
                      syntaxNode: name.parent,
                    });
                  }
                });
                const typeDeclarationName = TreeUtils.findFirstNamedChildOfType(
                  "upper_case_identifier",
                  typeDeclaration,
                );
                if (typeDeclarationName) {
                  exposed.push({
                    exposedUnionConstructors: unionConstructors,
                    name: typeDeclarationName.text,
                    syntaxNode: typeDeclaration,
                    type: "Type",
                  });
                }
              });
            }

            return { moduleName: moduleName.text, exposing: exposed };
          }
        } else {
          const exposedOperators = TreeUtils.descendantsOfType(
            exposingList,
            "operator_identifier",
          );

          for (const value of exposedOperators) {
            const functionNode = this.findOperator(tree, value.text);

            if (functionNode) {
              exposed.push({
                exposedUnionConstructors: undefined,
                name: value.text,
                syntaxNode: functionNode,
                type: "Operator",
              });
            }
          }

          const exposedValues = TreeUtils.descendantsOfType(
            exposingList,
            "exposed_value",
          );

          exposed.push(
            ...this.findExposedTopLevelFunctions(
              tree,
              exposedValues.map((a) => a.text),
            ),
          );

          const exposedTypes = TreeUtils.descendantsOfType(
            exposingList,
            "exposed_type",
          );
          for (const value of exposedTypes) {
            const doubleDot = TreeUtils.descendantsOfType(value, "double_dot");
            if (doubleDot.length > 0) {
              const name = TreeUtils.findFirstNamedChildOfType(
                "upper_case_identifier",
                value,
              );

              if (name) {
                const typeDeclaration = this.findTypeDeclaration(
                  tree,
                  name.text,
                );
                if (typeDeclaration) {
                  const unionConstructors: {
                    name: string;
                    syntaxNode: SyntaxNode;
                    accessibleWithoutPrefix: boolean;
                  }[] = [];
                  TreeUtils.descendantsOfType(
                    typeDeclaration,
                    "union_variant",
                  ).forEach((variant) => {
                    const unionConstructorName = TreeUtils.findFirstNamedChildOfType(
                      "upper_case_identifier",
                      variant,
                    );
                    if (unionConstructorName && unionConstructorName.parent) {
                      unionConstructors.push({
                        accessibleWithoutPrefix: true,
                        name: unionConstructorName.text,
                        syntaxNode: unionConstructorName.parent,
                      });
                    }
                  });

                  exposed.push({
                    exposedUnionConstructors: unionConstructors,
                    name: name.text,
                    syntaxNode: typeDeclaration,
                    type: "Type",
                  });
                }
              }
            } else {
              const typeNode = this.findTypeDeclaration(tree, value.text);

              if (typeNode) {
                exposed.push({
                  exposedUnionConstructors: undefined,
                  name: value.text,
                  syntaxNode: typeNode,
                  type: "Type",
                });
              } else {
                const typeAliasNode = this.findTypeAliasDeclaration(
                  tree,
                  value.text,
                );
                if (typeAliasNode) {
                  exposed.push({
                    exposedUnionConstructors: undefined,
                    name: value.text,
                    syntaxNode: typeAliasNode,
                    type: "TypeAlias",
                  });
                }
              }
            }
          }

          if (moduleName) {
            return { moduleName: moduleName.text, exposing: exposed };
          }
        }
      }
    }
  }

  public static findFirstNamedChildOfType(
    type: string,
    node: SyntaxNode,
  ): SyntaxNode | undefined {
    return node.children.find((child) => child.type === type);
  }

  public static findAllNamedChildrenOfType(
    type: string | string[],
    node: SyntaxNode,
  ): SyntaxNode[] | undefined {
    const result = Array.isArray(type)
      ? node.children.filter((child) => type.includes(child.type))
      : node.children.filter((child) => child.type === type);

    return result.length === 0 ? undefined : result;
  }

  public static findExposedFunctionNode(
    node: SyntaxNode,
    functionName: string,
  ): SyntaxNode | undefined {
    if (node) {
      const exposingList = this.findFirstNamedChildOfType(
        "exposing_list",
        node,
      );
      if (exposingList) {
        const doubleDot = this.findFirstNamedChildOfType(
          "double_dot",
          exposingList,
        );
        if (doubleDot) {
          return undefined;
        }
      }
      const descendants = TreeUtils.descendantsOfType(node, "exposed_value");
      return descendants.find((desc) => desc.text === functionName);
    }
  }

  public static isExposedFunction(tree: Tree, functionName: string): boolean {
    const module = this.findModuleDeclaration(tree);
    if (module) {
      const exposingList = this.findFirstNamedChildOfType(
        "exposing_list",
        module,
      );
      if (exposingList) {
        const doubleDot = this.findFirstNamedChildOfType(
          "double_dot",
          exposingList,
        );
        if (doubleDot) {
          return true;
        }
      }
      const descendants = TreeUtils.descendantsOfType(module, "exposed_value");
      return descendants.some((desc) => desc.text === functionName);
    }
    return false;
  }

  public static findExposedTypeOrTypeAliasNode(
    node: SyntaxNode,
    typeName: string,
  ): SyntaxNode | undefined {
    if (node) {
      const exposingList = this.findFirstNamedChildOfType(
        "exposing_list",
        node,
      );
      if (exposingList) {
        const doubleDot = this.findFirstNamedChildOfType(
          "double_dot",
          exposingList,
        );
        if (doubleDot) {
          return undefined;
        }
      }
      const descendants = TreeUtils.descendantsOfType(node, "exposed_type");
      const match = descendants.find((desc) => desc.text.startsWith(typeName));
      if (match && match.firstNamedChild) {
        return match.firstNamedChild;
      }
    }
    return undefined;
  }

  public static isExposedTypeOrTypeAlias(
    tree: Tree,
    typeName: string,
  ): boolean {
    const module = this.findModuleDeclaration(tree);
    if (module) {
      const exposingList = this.findFirstNamedChildOfType(
        "exposing_list",
        module,
      );
      if (exposingList) {
        const doubleDot = this.findFirstNamedChildOfType(
          "double_dot",
          exposingList,
        );
        if (doubleDot) {
          return true;
        }
      }
      const descendants = TreeUtils.descendantsOfType(module, "exposed_type");
      return descendants.some((desc) => desc.text.startsWith(typeName));
    }
    return false;
  }

  public static findUnionConstructor(
    tree: Tree,
    unionConstructorName: string,
  ): SyntaxNode | undefined {
    const unionVariants = TreeUtils.descendantsOfType(
      tree.rootNode,
      "union_variant",
    );
    if (unionVariants.length > 0) {
      return unionVariants.find(
        (a) =>
          a.firstChild !== null &&
          a.firstChild.type === "upper_case_identifier" &&
          a.firstChild.text === unionConstructorName,
      );
    }
  }

  public static findUnionConstructorCalls(
    tree: Tree,
    unionConstructorName: string,
  ): SyntaxNode[] | undefined {
    const upperCaseQid = TreeUtils.descendantsOfType(
      tree.rootNode,
      "upper_case_qid",
    );
    if (upperCaseQid.length > 0) {
      const result = upperCaseQid.filter(
        (a) =>
          a.firstChild !== null &&
          a.firstChild.type === "upper_case_identifier" &&
          a.firstChild.text === unionConstructorName &&
          a.parent &&
          a.parent.type !== "type_ref",
      );
      return result.length === 0 ? undefined : result;
    }
  }

  public static findLetFunctionNodeDefinition(
    syntaxNode: SyntaxNode,
    functionName: string,
  ): SyntaxNode | undefined {
    if (syntaxNode.previousNamedSibling?.type === "let") {
      const foundFunction = this.findFunction(
        syntaxNode.previousNamedSibling,
        functionName,
        false,
      );

      if (foundFunction) {
        return foundFunction;
      }
    }
    if (syntaxNode.parent && syntaxNode.parent.type === "let") {
      const foundFunction = this.findFunction(syntaxNode, functionName, false);

      if (foundFunction) {
        return foundFunction;
      }
    }
    if (syntaxNode.parent) {
      return this.findLetFunctionNodeDefinition(
        syntaxNode.parent,
        functionName,
      );
    }
  }

  public static findFunction(
    syntaxNode: SyntaxNode,
    functionName: string,
    onlySearchTopLevel = true,
  ): SyntaxNode | undefined {
    const functions = onlySearchTopLevel
      ? syntaxNode.children.filter((a) => a.type === "value_declaration")
      : syntaxNode.descendantsOfType("value_declaration");

    let ret;
    if (functions) {
      ret = functions.find((elmFunction) => {
        const declaration = TreeUtils.findFirstNamedChildOfType(
          "function_declaration_left",
          elmFunction,
        );
        if (declaration && declaration.firstNamedChild) {
          return functionName === declaration.firstNamedChild.text;
        }
      });

      if (!ret) {
        functions.forEach((elmFunction) => {
          const declaration = TreeUtils.findFirstNamedChildOfType(
            "pattern",
            elmFunction,
          );
          if (
            declaration &&
            declaration.children[0] &&
            declaration.children[0].children
          ) {
            ret = declaration.children[0].children
              .find((a) => functionName === a.text)
              ?.child(0);
            return;
          }
        });
      }
      return ret;
    }
  }

  public static findOperator(
    tree: Tree,
    operatorName: string,
  ): SyntaxNode | undefined {
    const infixDeclarations = this.findAllNamedChildrenOfType(
      "infix_declaration",
      tree.rootNode,
    );
    if (infixDeclarations) {
      const operatorNode = infixDeclarations.find((a) => {
        const operator = TreeUtils.findFirstNamedChildOfType(
          "operator_identifier",
          a,
        );
        if (operator) {
          return operator.text === operatorName;
        }
        return false;
      });

      if (operatorNode) {
        const functionReference = TreeUtils.findFirstNamedChildOfType(
          "value_expr",
          operatorNode,
        );
        if (functionReference) {
          return this.findFunction(tree.rootNode, functionReference.text);
        }
      }
    }
  }

  public static findTypeDeclaration(
    tree: Tree,
    typeName: string,
  ): SyntaxNode | undefined {
    const types = this.findAllTypeDeclarations(tree);
    if (types) {
      return types.find(
        (a) =>
          a.children.length > 1 &&
          a.children[1].type === "upper_case_identifier" &&
          a.children[1].text === typeName,
      );
    }
  }

  public static findModuleDeclaration(tree: Tree): SyntaxNode | undefined {
    return this.findFirstNamedChildOfType("module_declaration", tree.rootNode);
  }

  public static findTypeAliasDeclaration(
    tree: Tree,
    typeAliasName: string,
  ): SyntaxNode | undefined {
    const typeAliases = this.findAllTypeAliasDeclarations(tree);
    if (typeAliases) {
      return typeAliases.find(
        (a) =>
          a.children.length > 2 &&
          a.children[2].type === "upper_case_identifier" &&
          a.children[2].text === typeAliasName,
      );
    }
  }

  public static findAllTopLevelFunctionDeclarations(
    tree: Tree,
  ): SyntaxNode[] | undefined {
    const result = tree.rootNode.children.filter(
      (a) => a.type === "value_declaration",
    );
    return result.length === 0 ? undefined : result;
  }

  public static findAllTypeOrTypeAliasCalls(
    tree: Tree,
  ): SyntaxNode[] | undefined {
    const result: SyntaxNode[] = [];
    const typeRefs = TreeUtils.descendantsOfType(tree.rootNode, "type_ref");
    if (typeRefs.length > 0) {
      typeRefs.forEach((a) => {
        if (
          a.firstChild &&
          a.firstChild.type === "upper_case_qid" &&
          a.firstChild.firstChild
        ) {
          result.push(a.firstChild);
        }
      });
    }

    return result.length === 0 ? undefined : result;
  }

  public static getFunctionNameNodeFromDefinition(
    node: SyntaxNode,
  ): SyntaxNode | undefined {
    if (node.type === "lower_case_identifier") {
      return node;
    }
    const declaration = TreeUtils.findFirstNamedChildOfType(
      "function_declaration_left",
      node,
    );
    if (declaration && declaration.firstNamedChild) {
      return declaration.firstNamedChild;
    }
  }

  public static getTypeOrTypeAliasNameNodeFromDefinition(
    node: SyntaxNode,
  ): SyntaxNode | undefined {
    return TreeUtils.findFirstNamedChildOfType("upper_case_identifier", node);
  }

  public static findTypeOrTypeAliasCalls(
    tree: Tree,
    typeOrTypeAliasName: string,
  ): SyntaxNode[] | undefined {
    const typeOrTypeAliasNodes = this.findAllTypeOrTypeAliasCalls(tree);
    if (typeOrTypeAliasNodes) {
      const result: SyntaxNode[] = typeOrTypeAliasNodes.filter((a) => {
        return a.text === typeOrTypeAliasName;
      });

      return result.length === 0 ? undefined : result;
    }
  }

  public static findAllTypeDeclarations(tree: Tree): SyntaxNode[] | undefined {
    return this.findAllNamedChildrenOfType("type_declaration", tree.rootNode);
  }

  public static findAllTypeAliasDeclarations(
    tree: Tree,
  ): SyntaxNode[] | undefined {
    return this.findAllNamedChildrenOfType(
      "type_alias_declaration",
      tree.rootNode,
    );
  }

  public static findUppercaseQidNode(
    tree: Tree,
    nodeAtPosition: SyntaxNode,
  ): { node: SyntaxNode; nodeType: NodeType } | undefined {
    let definitionNode = this.findTypeDeclaration(tree, nodeAtPosition.text);
    if (definitionNode) {
      return { node: definitionNode, nodeType: "Type" };
    }
    definitionNode = this.findTypeAliasDeclaration(tree, nodeAtPosition.text);
    if (definitionNode) {
      return { node: definitionNode, nodeType: "TypeAlias" };
    }
    definitionNode = this.findUnionConstructor(tree, nodeAtPosition.text);
    if (definitionNode) {
      return { node: definitionNode, nodeType: "UnionConstructor" };
    }
  }

  public static findDefinitionNodeByReferencingNode(
    nodeAtPosition: SyntaxNode,
    uri: string,
    tree: Tree,
    imports: IImports,
    forest?: IForest,
  ): { node: SyntaxNode; uri: string; nodeType: NodeType } | undefined {
    if (
      nodeAtPosition.parent &&
      nodeAtPosition.parent.type === "upper_case_qid" &&
      nodeAtPosition.parent.previousNamedSibling &&
      nodeAtPosition.parent.previousNamedSibling.type === "module"
    ) {
      const moduleNode = nodeAtPosition.parent.parent;

      if (moduleNode) {
        return {
          node: moduleNode,
          nodeType: "Module",
          uri,
        };
      }
    } else if (
      nodeAtPosition.parent &&
      nodeAtPosition.parent.type === "upper_case_qid" &&
      nodeAtPosition.parent.previousNamedSibling &&
      nodeAtPosition.parent.previousNamedSibling.type === "import"
    ) {
      const upperCaseQid = nodeAtPosition.parent;
      const definitionFromOtherFile = this.findImportFromImportList(
        uri,
        upperCaseQid.text,
        "Module",
        imports,
      );
      if (definitionFromOtherFile) {
        return {
          node: definitionFromOtherFile.node,
          nodeType: "Module",
          uri: definitionFromOtherFile.fromUri,
        };
      }
    } else if (
      nodeAtPosition.parent &&
      nodeAtPosition.parent.type === "function_declaration_left"
    ) {
      const definitionNode =
        nodeAtPosition.parent.parent &&
        nodeAtPosition.parent.parent.parent &&
        nodeAtPosition.parent.parent.parent.type === "let"
          ? this.findFunction(
              nodeAtPosition.parent.parent.parent,
              nodeAtPosition.text,
              false,
            )
          : this.findFunction(tree.rootNode, nodeAtPosition.text);

      if (definitionNode) {
        return {
          node: definitionNode,
          nodeType: "Function",
          uri,
        };
      }
    } else if (
      (nodeAtPosition.parent &&
        nodeAtPosition.parent.type === "exposed_value" &&
        nodeAtPosition.parent.parent &&
        nodeAtPosition.parent.parent.parent &&
        nodeAtPosition.parent.parent.parent.type === "module_declaration") ||
      (nodeAtPosition.parent &&
        nodeAtPosition.parent.type === "type_annotation")
    ) {
      const definitionNode = TreeUtils.findFunction(
        tree.rootNode,
        nodeAtPosition.text,
      );

      if (definitionNode) {
        return {
          node: definitionNode,
          nodeType: "Function",
          uri,
        };
      }
    } else if (
      (nodeAtPosition.parent &&
        nodeAtPosition.parent.type === "exposed_type" &&
        nodeAtPosition.parent.parent &&
        nodeAtPosition.parent.parent.parent &&
        nodeAtPosition.parent.parent.parent.type === "module_declaration") ||
      (nodeAtPosition.previousNamedSibling &&
        (nodeAtPosition.previousNamedSibling.type === "type" ||
          nodeAtPosition.previousNamedSibling.type === "alias"))
    ) {
      const definitionNode = TreeUtils.findUppercaseQidNode(
        tree,
        nodeAtPosition,
      );

      if (definitionNode) {
        return {
          node: definitionNode.node,
          nodeType: definitionNode.nodeType,
          uri,
        };
      }
    } else if (
      nodeAtPosition.parent &&
      nodeAtPosition.parent.type === "exposed_value" &&
      nodeAtPosition.parent.parent &&
      nodeAtPosition.parent.parent.parent &&
      nodeAtPosition.parent.parent.parent.type === "import_clause"
    ) {
      const definitionFromOtherFile = this.findImportFromImportList(
        uri,
        nodeAtPosition.text,
        "Function",
        imports,
      );

      if (definitionFromOtherFile) {
        return {
          node: definitionFromOtherFile.node,
          nodeType: "Function",
          uri: definitionFromOtherFile.fromUri,
        };
      }
    } else if (
      nodeAtPosition.parent &&
      nodeAtPosition.parent.type === "exposed_type" &&
      nodeAtPosition.parent.parent &&
      nodeAtPosition.parent.parent.parent &&
      nodeAtPosition.parent.parent.parent.type === "import_clause"
    ) {
      const upperCaseQid = nodeAtPosition;
      let definitionFromOtherFile = this.findImportFromImportList(
        uri,
        upperCaseQid.text,
        "Type",
        imports,
      );
      if (definitionFromOtherFile) {
        return {
          node: definitionFromOtherFile.node,
          nodeType: "Type",
          uri: definitionFromOtherFile.fromUri,
        };
      }

      definitionFromOtherFile = this.findImportFromImportList(
        uri,
        upperCaseQid.text,
        "TypeAlias",
        imports,
      );
      if (definitionFromOtherFile) {
        return {
          node: definitionFromOtherFile.node,
          nodeType: "TypeAlias",
          uri: definitionFromOtherFile.fromUri,
        };
      }
    } else if (
      nodeAtPosition.parent &&
      nodeAtPosition.parent.type === "union_variant"
    ) {
      const definitionNode = nodeAtPosition.parent;
      return {
        node: definitionNode,
        nodeType: "UnionConstructor",
        uri,
      };
    } else if (
      nodeAtPosition.parent &&
      nodeAtPosition.parent.type === "upper_case_qid"
    ) {
      const upperCaseQid = nodeAtPosition.parent;
      const definitionNode = TreeUtils.findUppercaseQidNode(tree, upperCaseQid);

      let definitionFromOtherFile;
      if (!definitionNode) {
        // Make sure the next node is a dot, or else it isn't a Module
        if (TreeUtils.nextNode(nodeAtPosition)?.type === "dot") {
          const endPos =
            upperCaseQid.text.indexOf(nodeAtPosition.text) +
            nodeAtPosition.text.length;

          const moduleNameOrAlias = nodeAtPosition.parent.text.substring(
            0,
            endPos,
          );
          const moduleName =
            TreeUtils.findImportNameNode(tree, moduleNameOrAlias)?.text ??
            moduleNameOrAlias;

          definitionFromOtherFile = this.findImportFromImportList(
            uri,
            moduleName,
            "Module",
            imports,
          );
          if (definitionFromOtherFile) {
            return {
              node: definitionFromOtherFile.node,
              nodeType: "Module",
              uri: definitionFromOtherFile.fromUri,
            };
          }
        }

        definitionFromOtherFile = this.findImportFromImportList(
          uri,
          upperCaseQid.text,
          "Type",
          imports,
        );
        if (definitionFromOtherFile) {
          return {
            node: definitionFromOtherFile.node,
            nodeType: "Type",
            uri: definitionFromOtherFile.fromUri,
          };
        }

        definitionFromOtherFile = this.findImportFromImportList(
          uri,
          upperCaseQid.text,
          "TypeAlias",
          imports,
        );
        if (definitionFromOtherFile) {
          return {
            node: definitionFromOtherFile.node,
            nodeType: "TypeAlias",
            uri: definitionFromOtherFile.fromUri,
          };
        }

        definitionFromOtherFile = this.findImportFromImportList(
          uri,
          upperCaseQid.text,
          "UnionConstructor",
          imports,
        );
        if (definitionFromOtherFile) {
          return {
            node: definitionFromOtherFile.node,
            nodeType: "UnionConstructor",
            uri: definitionFromOtherFile.fromUri,
          };
        }
      }
      if (definitionNode) {
        return {
          node: definitionNode.node,
          nodeType: definitionNode.nodeType,
          uri,
        };
      }
    } else if (
      nodeAtPosition.parent &&
      (nodeAtPosition.parent.type === "value_qid" ||
        nodeAtPosition.parent.type === "lower_pattern" ||
        nodeAtPosition.parent.type === "record_base_identifier")
    ) {
      let nodeAtPositionText = nodeAtPosition.text;
      if (nodeAtPosition.parent.type === "value_qid") {
        nodeAtPositionText = nodeAtPosition.parent.text;
      }

      const caseOfParameter = this.findCaseOfParameterDefinition(
        nodeAtPosition,
        nodeAtPositionText,
      );

      if (caseOfParameter) {
        return {
          node: caseOfParameter,
          nodeType: "CasePattern",
          uri,
        };
      }

      const anonymousFunctionDefinition = this.findAnonymousFunctionParameterDefinition(
        nodeAtPosition,
        nodeAtPositionText,
      );

      if (anonymousFunctionDefinition) {
        return {
          node: anonymousFunctionDefinition,
          nodeType: "AnonymousFunctionParameter",
          uri,
        };
      }

      const functionParameter = this.findFunctionParameterDefinition(
        nodeAtPosition,
        nodeAtPositionText,
      );

      if (functionParameter) {
        return {
          node: functionParameter,
          nodeType: "FunctionParameter",
          uri,
        };
      }

      const letDefinitionNode = this.findLetFunctionNodeDefinition(
        nodeAtPosition,
        nodeAtPositionText,
      );

      if (letDefinitionNode) {
        return {
          node: letDefinitionNode,
          nodeType: "Function",
          uri,
        };
      }

      const topLevelDefinitionNode = TreeUtils.findFunction(
        tree.rootNode,
        nodeAtPosition.parent.text,
      );

      if (!topLevelDefinitionNode) {
        // Get the full module name and handle an import alias if there is one
        const endPos =
          nodeAtPosition.parent.text.indexOf(nodeAtPosition.text) +
          nodeAtPosition.text.length;
        const moduleNameOrAlias = nodeAtPosition.parent.text.substring(
          0,
          endPos,
        );
        const moduleName =
          TreeUtils.findImportNameNode(tree, moduleNameOrAlias)?.text ??
          moduleNameOrAlias;

        const moduleDefinitionFromOtherFile = this.findImportFromImportList(
          uri,
          moduleName,
          "Module",
          imports,
        );

        if (moduleDefinitionFromOtherFile) {
          return {
            node: moduleDefinitionFromOtherFile.node,
            nodeType: "Module",
            uri: moduleDefinitionFromOtherFile.fromUri,
          };
        }

        const functionDefinitionFromOtherFile = this.findImportFromImportList(
          uri,
          nodeAtPosition.parent.text,
          "Function",
          imports,
        );

        if (functionDefinitionFromOtherFile) {
          return {
            node: functionDefinitionFromOtherFile.node,
            nodeType: "Function",
            uri: functionDefinitionFromOtherFile.fromUri,
          };
        }
      }

      if (topLevelDefinitionNode) {
        return {
          node: topLevelDefinitionNode,
          nodeType: "Function",
          uri,
        };
      }
    } else if (nodeAtPosition.type === "operator_identifier") {
      const definitionNode = TreeUtils.findOperator(tree, nodeAtPosition.text);

      if (!definitionNode) {
        const definitionFromOtherFile = this.findImportFromImportList(
          uri,
          nodeAtPosition.text,
          "Operator",
          imports,
        );

        if (definitionFromOtherFile) {
          return {
            node: definitionFromOtherFile.node,
            nodeType: "Operator",
            uri: definitionFromOtherFile.fromUri,
          };
        }
      }
      if (definitionNode) {
        return { node: definitionNode, uri, nodeType: "Operator" };
      }
    } else if (nodeAtPosition.parent?.parent?.type === "field_access_expr") {
      const variableNodes = this.descendantsOfType(
        nodeAtPosition.parent.parent,
        "lower_case_identifier",
      );
      if (variableNodes.length > 0) {
        const indexOfNode = variableNodes.findIndex(
          (varNode) => varNode.text === nodeAtPosition.text,
        );

        const variableRef = TreeUtils.findDefinitionNodeByReferencingNode(
          variableNodes[indexOfNode > 0 ? indexOfNode - 1 : 0],
          uri,
          tree,
          imports,
        );

        let variableDef: SyntaxNode | null | undefined =
          TreeUtils.getTypeOrTypeAliasOfFunctionParameter(variableRef?.node) ??
          TreeUtils.getReturnTypeOrTypeAliasOfFunctionDefinition(
            variableRef?.node,
          );

        if (!variableDef && variableRef?.node)
          variableDef = TreeUtils.findFirstNamedChildOfType(
            "type_expression",
            variableRef.node,
          )?.firstNamedChild;

        if (variableDef) {
          const variableType = TreeUtils.findDefinitionNodeByReferencingNode(
            variableDef.firstNamedChild?.firstNamedChild ?? variableDef,
            uri,
            tree,
            imports,
          );

          const fieldName = nodeAtPosition.text;

          if (variableType) {
            const fieldNode = TreeUtils.descendantsOfType(
              variableType.node,
              "field_type",
            ).find((f) => {
              return f.firstNamedChild?.text === fieldName;
            });

            if (fieldNode) {
              return {
                node: fieldNode,
                nodeType: "FieldType",
                uri: variableType.uri,
              };
            }
          }
        }
      }
    } else if (
      nodeAtPosition.parent?.parent?.type === "record_expr" &&
      forest
    ) {
      const typeDef = TreeUtils.getTypeAliasOfRecord(
        nodeAtPosition,
        tree,
        imports,
        uri,
        forest,
      );

      const fieldName = nodeAtPosition.text;

      if (typeDef) {
        const fieldNode = TreeUtils.descendantsOfType(
          typeDef.node,
          "field_type",
        ).find((f) => {
          return f.firstNamedChild?.text === fieldName;
        });

        if (fieldNode) {
          return {
            node: fieldNode,
            nodeType: "FieldType",
            uri: typeDef.uri,
          };
        }
      }
    } else if (
      nodeAtPosition.type === "upper_case_identifier" &&
      nodeAtPosition.parent?.type === "ERROR"
    ) {
      let fullModuleName = nodeAtPosition.text;

      // Get fully qualified module name
      // Ex: nodeAtPosition.text is Attributes, we need to get Html.Attributes manually
      let currentNode = nodeAtPosition.previousNamedSibling;
      while (
        currentNode?.type === "dot" &&
        currentNode.previousNamedSibling?.type === "upper_case_identifier"
      ) {
        fullModuleName = `${currentNode.previousNamedSibling.text}.${fullModuleName}`;
        currentNode = currentNode.previousNamedSibling.previousNamedSibling;
      }

      const definitionFromOtherFile = this.findImportFromImportList(
        uri,
        TreeUtils.findImportNameNode(tree, fullModuleName)?.text ??
          fullModuleName,
        "Module",
        imports,
      );
      if (definitionFromOtherFile) {
        return {
          node: definitionFromOtherFile.node,
          nodeType: "Module",
          uri: definitionFromOtherFile.fromUri,
        };
      }
    }

    const parentType =
      TreeUtils.findParentOfType("type_annotation", nodeAtPosition) ??
      TreeUtils.findParentOfType("type_declaration", nodeAtPosition) ??
      TreeUtils.findParentOfType("type_alias_declaration", nodeAtPosition);

    if (parentType?.type === "type_annotation") {
      const ancestorDeclarations = TreeUtils.getAllAncestorValueDeclarations(
        parentType,
      );

      const allAnnotations = [
        ...ancestorDeclarations
          .map((n) => TreeUtils.getTypeAnnotation(n))
          .filter((n) => !!n)
          .reverse(),
        parentType,
      ];

      // Remove `flatMap` function when Node 10 is dropped
      const callback = (annotation: SyntaxNode | undefined): SyntaxNode[] =>
        annotation
          ? TreeUtils.descendantsOfType(annotation, "type_variable")
          : [];

      const allTypeVariables: SyntaxNode[] = allAnnotations.flatMap
        ? allAnnotations.flatMap(callback)
        : flatMap(allAnnotations, callback);

      const firstMatching = allTypeVariables.find(
        (t) => t.text === nodeAtPosition.text,
      );

      if (firstMatching) {
        return {
          node: firstMatching,
          nodeType: "TypeVariable",
          uri,
        };
      }
    } else if (parentType) {
      const allTypeNames = TreeUtils.findAllNamedChildrenOfType(
        "lower_type_name",
        parentType,
      );

      const firstMatching = allTypeNames?.find(
        (t) => t.text === nodeAtPosition.text,
      );

      if (firstMatching) {
        return {
          node: firstMatching,
          nodeType: "TypeVariable",
          uri,
        };
      }
    }
  }

  public static findFunctionParameterDefinition(
    node: SyntaxNode,
    functionParameterName: string,
  ): SyntaxNode | undefined {
    if (node.parent) {
      if (
        (node.parent.type === "value_declaration" ||
          node.parent.type === "ERROR") &&
        node.parent.firstChild &&
        node.parent.firstChild.type === "function_declaration_left"
      ) {
        if (node.parent.firstChild) {
          const match = this.descendantsOfType(
            node.parent.firstChild,
            "lower_pattern",
          ).find((a) => a.text === functionParameterName);
          if (match) {
            return match;
          } else {
            return this.findFunctionParameterDefinition(
              node.parent,
              functionParameterName,
            );
          }
        }
      } else {
        return this.findFunctionParameterDefinition(
          node.parent,
          functionParameterName,
        );
      }
    }
  }

  public static findAnonymousFunctionParameterDefinition(
    node: SyntaxNode,
    functionParameterName: string,
  ): SyntaxNode | undefined {
    if (node && node.type === "parenthesized_expr") {
      const anonymousFunctionExprNodes = this.descendantsOfType(
        node,
        "anonymous_function_expr",
      );
      const match = anonymousFunctionExprNodes
        .map((a) => a.children)
        .reduce((a, b) => a.concat(b), [])
        .find(
          (child) =>
            child.type === "pattern" && child.text === functionParameterName,
        );

      if (match) {
        return match;
      }
    }
    if (node.parent) {
      return this.findAnonymousFunctionParameterDefinition(
        node.parent,
        functionParameterName,
      );
    }
  }

  public static findCaseOfParameterDefinition(
    node: SyntaxNode,
    caseParameterName: string,
  ): SyntaxNode | undefined {
    if (node.parent) {
      if (
        node.parent.type === "case_of_branch" &&
        node.parent.firstChild &&
        node.parent.firstChild.firstChild &&
        node.parent.firstChild.type === "pattern"
      ) {
        if (node.parent.firstChild) {
          const match = node.parent.firstChild.firstChild.children.find(
            (a) => a.type === "lower_pattern" && a.text === caseParameterName,
          );
          if (match) {
            return match;
          } else {
            return this.findCaseOfParameterDefinition(
              node.parent,
              caseParameterName,
            );
          }
        }
      } else {
        return this.findCaseOfParameterDefinition(
          node.parent,
          caseParameterName,
        );
      }
    }
  }

  public static findImportFromImportList(
    uri: string,
    nodeName: string,
    type: NodeType,
    imports: IImports,
  ): IImport | undefined {
    if (imports.imports) {
      const allFileImports = imports.imports[uri];
      if (allFileImports) {
        // We prefer explicitlyExposed functions as in "import Foo exposing (Bar)" to "import Bar exposing (..)"
        const foundNode = allFileImports.find(
          (a) => a.alias === nodeName && a.type === type && a.explicitlyExposed,
        );
        if (foundNode) {
          return foundNode;
        } else {
          const foundNode = allFileImports.find(
            (a) => a.alias === nodeName && a.type === type,
          );
          if (foundNode) {
            return foundNode;
          }
        }
      }
    }
  }

  public static findImportClauseByName(
    tree: Tree,
    moduleName: string,
  ): SyntaxNode | undefined {
    const allImports = this.findAllImportClauseNodes(tree);
    if (allImports) {
      return allImports.find(
        (a) =>
          a.children.length > 1 &&
          a.children[1].type === "upper_case_qid" &&
          a.children[1].text === moduleName,
      );
    }
  }

  public static getAllImportedValues(
    forest: IForest,
    tree: Tree,
  ): { module: string; value: string }[] {
    const allImports = TreeUtils.findAllImportClauseNodes(tree);

    const allImportedValues: { module: string; value: string }[] = [];

    if (allImports) {
      allImports.forEach((importClause) => {
        const exposingList = TreeUtils.findFirstNamedChildOfType(
          "exposing_list",
          importClause,
        );

        const moduleName = TreeUtils.findFirstNamedChildOfType(
          "upper_case_qid",
          importClause,
        )?.text;

        if (exposingList && moduleName) {
          TreeUtils.findAllNamedChildrenOfType(
            ["exposed_value", "exposed_type"],
            exposingList,
          )?.forEach((node) => {
            allImportedValues.push({
              module: moduleName,
              value: node.text,
            });
            // Todo: Add exposing union constructors
          });

          // Handle all imports
          if (exposingList.text === "exposing (..)") {
            const moduleTree = forest.treeIndex.find(
              (tree) => tree.moduleName === moduleName,
            );

            moduleTree?.exposing?.forEach((exposed) => {
              allImportedValues.push({
                module: moduleName,
                value: exposed.name,
              });

              exposed.exposedUnionConstructors?.forEach((exposedUnion) => {
                allImportedValues.push({
                  module: moduleName,
                  value: exposedUnion.name,
                });
              });
            });
          }
        }
      });
    }

    return allImportedValues;
  }

  public static findImportNameNode(
    tree: Tree,
    moduleName: string,
  ): SyntaxNode | undefined {
    const allImports = this.findAllImportClauseNodes(tree);
    if (allImports) {
      const match = allImports.find(
        (a) =>
          (a.children.length > 1 &&
            a.children[1].type === "upper_case_qid" &&
            a.children[1].text === moduleName) ||
          (a.children.length > 2 &&
            a.children[2].type === "as_clause" &&
            a.children[2].lastNamedChild?.text === moduleName),
      );
      if (match) {
        return match.children[1];
      }
    }
  }

  public static getTypeOrTypeAliasOfFunctionParameter(
    node: SyntaxNode | undefined,
  ): SyntaxNode | undefined {
    if (
      node &&
      node.parent &&
      node.parent.parent &&
      node.parent.parent.previousNamedSibling &&
      node.parent.parent.previousNamedSibling.type === "type_annotation" &&
      node.parent.parent.previousNamedSibling.lastNamedChild
    ) {
      const functionParameterNodes = TreeUtils.findAllNamedChildrenOfType(
        ["pattern", "lower_pattern"],
        node.parent,
      );
      if (functionParameterNodes) {
        const matchIndex = functionParameterNodes.findIndex(
          (a) => a.text === node.text,
        );

        const typeAnnotationNodes = TreeUtils.findAllNamedChildrenOfType(
          ["type_ref", "type_expression"],
          node.parent.parent.previousNamedSibling.lastNamedChild,
        );
        if (typeAnnotationNodes) {
          return typeAnnotationNodes[matchIndex];
        }
      }
    }
  }

  public static getReturnTypeOrTypeAliasOfFunctionDefinition(
    node: SyntaxNode | undefined,
  ): SyntaxNode | undefined {
    if (node && node.previousNamedSibling?.type === "type_annotation") {
      const typeAnnotationNodes = TreeUtils.descendantsOfType(
        node.previousNamedSibling,
        "type_ref",
      );
      if (typeAnnotationNodes) {
        const type = typeAnnotationNodes[typeAnnotationNodes.length - 1];
        return type.firstNamedChild?.firstNamedChild ?? type;
      }
    }
  }

  public static getTypeOrTypeAliasOfFunctionRecordParameter(
    node: SyntaxNode | undefined,
    tree: Tree,
    imports: IImports,
    uri: string,
  ): SyntaxNode | undefined {
    if (
      node?.parent?.type === "function_call_expr" &&
      node.parent.firstNamedChild
    ) {
      const parameterIndex =
        node.parent.namedChildren.map((c) => c.text).indexOf(node.text) - 1;

      const functionName = TreeUtils.descendantsOfType(
        node.parent.firstNamedChild,
        "lower_case_identifier",
      );

      const functionDefinition = TreeUtils.findDefinitionNodeByReferencingNode(
        functionName[functionName.length - 1],
        uri,
        tree,
        imports,
      );

      if (functionDefinition?.node.previousNamedSibling?.lastNamedChild) {
        const typeAnnotationNodes = TreeUtils.findAllNamedChildrenOfType(
          ["type_ref", "record_type"],
          functionDefinition.node.previousNamedSibling.lastNamedChild,
        );

        if (typeAnnotationNodes) {
          const typeNode = typeAnnotationNodes[parameterIndex];

          if (typeNode?.type === "type_ref") {
            const typeNodes = TreeUtils.descendantsOfType(
              typeNode,
              "upper_case_identifier",
            );

            if (typeNodes.length > 0) {
              return TreeUtils.findDefinitionNodeByReferencingNode(
                typeNodes[0],
                uri,
                tree,
                imports,
              )?.node;
            }
          } else {
            return typeNode || undefined;
          }
        }
      }
    }
  }

  public static getTypeAliasOfRecordField(
    node: SyntaxNode | undefined,
    tree: Tree,
    imports: IImports,
    uri: string,
    forest: IForest,
  ): { node: SyntaxNode; uri: string } | undefined {
    const fieldName = node?.parent?.firstNamedChild?.text;

    let recordType = TreeUtils.getTypeAliasOfRecord(
      node,
      tree,
      imports,
      uri,
      forest,
    );

    while (!recordType && node?.parent?.parent) {
      node = node.parent.parent;
      recordType = TreeUtils.getTypeAliasOfRecordField(
        node,
        tree,
        imports,
        uri,
        forest,
      );
    }

    if (recordType) {
      const fieldTypes = TreeUtils.descendantsOfType(
        recordType.node,
        "field_type",
      );
      const fieldNode = fieldTypes.find((a) => {
        return (
          TreeUtils.findFirstNamedChildOfType("lower_case_identifier", a)
            ?.text === fieldName
        );
      });

      if (fieldNode) {
        const typeExpression = TreeUtils.findFirstNamedChildOfType(
          "type_expression",
          fieldNode,
        );

        if (typeExpression) {
          const typeNode = TreeUtils.descendantsOfType(
            typeExpression,
            "upper_case_identifier",
          );

          if (typeNode.length > 0) {
            const typeAliasNode = TreeUtils.findDefinitionNodeByReferencingNode(
              typeNode[0],
              recordType.uri,
              tree,
              imports,
            );

            if (typeAliasNode) {
              return { node: typeAliasNode.node, uri: typeAliasNode.uri };
            }
          }
        }
      }
    }
  }

  public static getTypeAliasOfCase(
    type: SyntaxNode | undefined,
    tree: Tree,
    imports: IImports,
    uri: string,
    forest: IForest,
  ): { node: SyntaxNode; uri: string } | undefined {
    if (type) {
      const definitionNode = TreeUtils.findDefinitionNodeByReferencingNode(
        type,
        uri,
        tree,
        imports,
      );

      if (definitionNode) {
        const definitionTree = forest.getTree(definitionNode.uri);

        let aliasNode;
        if (definitionNode.nodeType === "FunctionParameter") {
          aliasNode = TreeUtils.getTypeOrTypeAliasOfFunctionParameter(
            definitionNode.node,
          );
        } else if (definitionNode.nodeType === "Function") {
          aliasNode = TreeUtils.getReturnTypeOrTypeAliasOfFunctionDefinition(
            definitionNode.node,
          );
        } else if (definitionNode.nodeType === "FieldType") {
          aliasNode = TreeUtils.findFirstNamedChildOfType(
            "type_expression",
            definitionNode.node,
          );
        } else if (definitionNode.nodeType === "TypeAlias") {
          return { node: definitionNode.node, uri: definitionNode.uri };
        }

        if (aliasNode && definitionTree) {
          const childNode = TreeUtils.descendantsOfType(
            aliasNode,
            "upper_case_identifier",
          );

          if (childNode.length > 0) {
            const typeNode = TreeUtils.findDefinitionNodeByReferencingNode(
              childNode[0],
              definitionNode.uri,
              definitionTree,
              imports,
            );

            if (typeNode) {
              return { node: typeNode.node, uri: typeNode.uri };
            }
          }
        }
      }
    }
  }

  public static getTypeAliasOfRecord(
    node: SyntaxNode | undefined,
    tree: Tree,
    imports: IImports,
    uri: string,
    forest: IForest,
  ): { node: SyntaxNode; uri: string } | undefined {
    if (node?.parent?.parent) {
      let type: SyntaxNode | undefined | null =
        TreeUtils.findFirstNamedChildOfType(
          "record_base_identifier",
          node.parent.parent,
        ) ??
        TreeUtils.findFirstNamedChildOfType(
          "record_base_identifier",
          node.parent,
        );

      // Handle records of function returns
      if (!type && node.parent.parent.parent) {
        type =
          TreeUtils.getReturnTypeOrTypeAliasOfFunctionDefinition(
            node.parent.parent.parent,
          )?.parent ?? undefined;
      }

      if (!type) {
        type = node;
      }

      if (type) {
        const definitionNode = TreeUtils.findDefinitionNodeByReferencingNode(
          type.firstNamedChild ? type.firstNamedChild : type,
          uri,
          tree,
          imports,
        );

        if (definitionNode) {
          const definitionTree = forest.getTree(definitionNode.uri);

          let aliasNode;
          if (definitionNode.nodeType === "FunctionParameter") {
            aliasNode = TreeUtils.getTypeOrTypeAliasOfFunctionParameter(
              definitionNode.node,
            );
          } else if (definitionNode.nodeType === "Function") {
            aliasNode = TreeUtils.getReturnTypeOrTypeAliasOfFunctionDefinition(
              definitionNode.node,
            );
          } else if (definitionNode.nodeType === "FieldType") {
            aliasNode = TreeUtils.findFirstNamedChildOfType(
              "type_expression",
              definitionNode.node,
            );
          } else if (definitionNode.nodeType === "TypeAlias") {
            return { node: definitionNode.node, uri: definitionNode.uri };
          }

          if (aliasNode && definitionTree) {
            const childNode = TreeUtils.descendantsOfType(
              aliasNode,
              "upper_case_identifier",
            );

            if (childNode.length > 0) {
              const typeNode = TreeUtils.findDefinitionNodeByReferencingNode(
                childNode[0],
                definitionNode.uri,
                definitionTree,
                imports,
              );

              if (typeNode) {
                return { node: typeNode.node, uri: typeNode.uri };
              }
            }
          }
        }
      }
    }
  }

  public static getAllFieldsFromTypeAlias(
    node: SyntaxNode | undefined,
  ): { field: string; type: string }[] | undefined {
    const result: { field: string; type: string }[] = [];
    if (node) {
      const fieldTypes = TreeUtils.descendantsOfType(node, "field_type");
      if (fieldTypes.length > 0) {
        fieldTypes.forEach((a) => {
          const fieldName = TreeUtils.findFirstNamedChildOfType(
            "lower_case_identifier",
            a,
          );
          const typeExpression = TreeUtils.findFirstNamedChildOfType(
            "type_expression",
            a,
          );
          if (fieldName && typeExpression) {
            result.push({ field: fieldName.text, type: typeExpression.text });
          }
        });
      }
    }
    return result.length === 0 ? undefined : result;
  }

  public static descendantsOfType(
    node: SyntaxNode,
    type: string,
  ): SyntaxNode[] {
    return node.descendantsOfType(type);
  }

  public static getNamedDescendantForPosition(
    node: SyntaxNode,
    position: Position,
  ): SyntaxNode {
    const previousCharColumn =
      position.character === 0 ? 0 : position.character - 1;
    const charBeforeCursor = node.text
      .split("\n")
      [position.line].substring(previousCharColumn, position.character);

    if (!functionNameRegex.test(charBeforeCursor)) {
      return node.namedDescendantForPosition({
        column: position.character,
        row: position.line,
      });
    } else {
      return node.namedDescendantForPosition(
        {
          column: previousCharColumn,
          row: position.line,
        },
        {
          column: position.character,
          row: position.line,
        },
      );
    }
  }

  public static findPreviousNode(
    node: SyntaxNode,
    position: Position,
  ): SyntaxNode | undefined {
    function nodeHasTokens(n: SyntaxNode): boolean {
      return n.endIndex - n.startIndex !== 0;
    }

    function findRightmostChildWithTokens(
      childrenList: SyntaxNode[],
      startIndex: number,
    ): SyntaxNode | undefined {
      for (let i = startIndex - 1; i >= 0; i--) {
        if (nodeHasTokens(childrenList[i])) {
          return childrenList[i];
        }
      }
    }

    function findRightmostNode(n: SyntaxNode): SyntaxNode | undefined {
      if (n.children.length === 0) {
        return n;
      }

      const candidate = findRightmostChildWithTokens(
        n.children,
        n.children.length,
      );

      if (candidate) {
        return findRightmostNode(candidate);
      }
    }

    const children = node.children;

    if (children.length === 0) {
      return node;
    }

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (comparePosition(position, child.endPosition) < 0) {
        const lookInPreviousChild =
          comparePosition(position, child.startPosition) <= 0 ||
          !nodeHasTokens(child);

        if (lookInPreviousChild) {
          const candidate = findRightmostChildWithTokens(children, i);
          if (candidate) {
            return findRightmostNode(candidate);
          }
        } else {
          return this.findPreviousNode(child, position);
        }
      }
    }

    const candidate = findRightmostChildWithTokens(children, children.length);
    if (candidate) {
      return findRightmostNode(candidate);
    }
  }

  public static getNamedDescendantForLineBeforePosition(
    node: SyntaxNode,
    position: Position,
  ): SyntaxNode {
    const previousLine = position.line === 0 ? 0 : position.line - 1;

    return node.namedDescendantForPosition({
      column: 0,
      row: previousLine,
    });
  }

  public static getNamedDescendantForLineAfterPosition(
    node: SyntaxNode,
    position: Position,
  ): SyntaxNode {
    const followingLine = position.line + 1;

    return node.namedDescendantForPosition({
      column: 0,
      row: followingLine,
    });
  }

  public static findParentOfType(
    typeToLookFor: string,
    node: SyntaxNode,
  ): SyntaxNode | undefined {
    if (node.type === typeToLookFor) {
      return node;
    }
    if (node.parent) {
      return this.findParentOfType(typeToLookFor, node.parent);
    }
  }

  public static getLastImportNode(tree: Tree): SyntaxNode | undefined {
    const allImportNodes = this.findAllImportClauseNodes(tree);
    if (allImportNodes?.length) {
      return allImportNodes[allImportNodes.length - 1];
    }
  }

  public static isReferenceFullyQualified(node: SyntaxNode): boolean {
    return (
      node.previousNamedSibling?.type === "dot" &&
      node.previousNamedSibling?.previousNamedSibling?.type ===
        "upper_case_identifier"
    );
  }

  public static getTypeAnnotation(
    valueDeclaration?: SyntaxNode,
  ): SyntaxNode | undefined {
    if (valueDeclaration?.type !== "value_declaration") {
      return;
    }

    let candidate = valueDeclaration.previousNamedSibling;

    // Skip comments
    while (
      candidate?.type === "line_comment" ||
      candidate?.type === "comment_block"
    ) {
      candidate = candidate.previousNamedSibling;
    }

    if (candidate?.type === "type_annotation") {
      return candidate;
    }
  }

  /**
   * This gets a list of all ancestor value declarations
   * in order from the closest declaration up to the top level declaration
   */
  public static getAllAncestorValueDeclarations(
    node: SyntaxNode,
  ): SyntaxNode[] {
    const declarations = [];

    while (node.type !== "file") {
      if (node.type === "value_declaration") {
        declarations.push(node);
      }

      if (node.parent) {
        node = node.parent;
      } else {
        break;
      }
    }

    return declarations;
  }

  private static findExposedTopLevelFunctions(
    tree: Tree,
    functionNamesToFind: string[],
  ): IExposing[] {
    return tree.rootNode.children
      .filter(
        (node) =>
          node.type === "value_declaration" &&
          node.namedChildren.some(
            (a: SyntaxNode) => a.type === "function_declaration_left",
          ),
      )
      .map((node) =>
        node.namedChildren.find(
          (child) =>
            child.type === "function_declaration_left" &&
            child.firstNamedChild?.text,
        ),
      )
      .filter(Utils.notUndefined)
      .map((node: SyntaxNode) => {
        return { node, text: node.firstNamedChild?.text };
      })
      .filter((node) => functionNamesToFind.includes(node.text!))
      .map(
        (functionNode): IExposing => {
          return {
            exposedUnionConstructors: undefined,
            name: functionNode.text!,
            syntaxNode: functionNode.node.parent!,
            type: "Function",
          };
        },
      );
  }

  public static findAllImportClauseNodes(tree: Tree): SyntaxNode[] | undefined {
    const result = tree.rootNode.children.filter(
      (a) => a.type === "import_clause",
    );

    return result.length === 0 ? undefined : result;
  }

  public static isIdentifier(node: SyntaxNode): boolean {
    return (
      node.type === "lower_case_identifier" ||
      node.type === "upper_case_identifier"
    );
  }

  public static isImport(node: SyntaxNode): boolean {
    return (
      node.parent?.firstNamedChild?.type === "import" ||
      node.parent?.parent?.firstNamedChild?.type === "import"
    );
  }

  public static nextNode(node: SyntaxNode): SyntaxNode | undefined {
    // Move up until we have a sibling
    while (!node.nextNamedSibling && node.parent) {
      node = node.parent;
    }

    if (node.nextNamedSibling) {
      node = node.nextNamedSibling;

      // Move down the leftmost subtree
      while (node.firstNamedChild) {
        node = node.firstNamedChild;
      }

      return node;
    }
  }
}
