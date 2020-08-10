import { container } from "tsyringe";
import { Forest } from "../../src/forest";
import { DefinitionProviderTestBase } from "./definitionProviderTestBase";

beforeEach(() => {
  container.registerSingleton("Forest", Forest);
});

describe("aliasedImportDefinition", () => {
  const testBase = new DefinitionProviderTestBase();

  it(`test aliased, qualified value ref`, async () => {
    const source = `
--@ main.elm
import Foo as F
main = F.bar
         --^Foo.elm
--@ Foo.elm
module Foo exposing (bar)
bar = 42
`;
    await testBase.testDefinition(source);
  });

  it(`test aliased, qualified union type ref`, async () => {
    const source = `
--@ main.elm
import App as A
type alias Model = A.Page
                     --^App.elm
--@ App.elm
module App exposing (Page)
type Page = Home
`;
    await testBase.testDefinition(source);
  });

  xit(`test aliased, qualified union constructor ref`, async () => {
    const source = `
--@ main.elm
import App as A
defaultPage = A.Home
                --^App.elm
--@ App.elm
module App exposing (Page(Home))
type Page = Home
`;
    await testBase.testDefinition(source);
  });

  it(`test aliased, qualified type alias ref`, async () => {
    const source = `
--@ main.elm
import App as A
type Entity = PersonEntity A.Person
                             --^App.elm
--@ App.elm
module App exposing (Person)
type alias Person = { name : String, age: Int }
`;
    await testBase.testDefinition(source);
  });

  it(`test aliased, qualified record constructor ref`, async () => {
    const source = `
--@ main.elm
import App as A
defaultPerson = A.Person "George" 42
                  --^App.elm
--@ App.elm
module App exposing (Person)
type alias Person = { name : String, age: Int }
`;
    await testBase.testDefinition(source);
  });

  // issue #93
  it(`test introducing an alias hides the original module name from qualified refs`, async () => {
    const source = `
--@ main.elm
import Foo as F
main = Foo.bar
           --^unresolved
--@ Foo.elm
module Foo exposing (bar)
bar = 42
`;
    await testBase.testDefinition(source);
  });

  it.only(`test an import with an alias still provides a ref for the original module name`, async () => {
    const source = `
--@ main.elm
import Foo as F
       --^Foo.elm
--@ Foo.elm
module Foo exposing (bar)
bar = 42
`;
    await testBase.testDefinition(source);
  });
});
