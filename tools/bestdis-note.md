# BESTDIS を今の .NET で動かす

`docs/smg2-write-protocol.md` の全内容は、BMW の SGBD `C:\EDIABAS\ECU\SMG2.prg` を
EdiabasLib の BESTDIS で逆アセンブルして得たものです。再現手順はこれだけですが、
そのままでは動きません。**2 箇所で詰まります。**

## 1. プロジェクトが .NET Framework 3.5 のまま

`C:\EC-APPS\ediabaslib\Tools\BESTDIS\BESTDIS.csproj` は旧形式で、`dotnet build` は
「スペルが間違っています」に見える紛らわしい失敗をします（実際は SDK 形式でないだけ）。
`Program.cs` は System / System.Xml しか使っていないので、SDK 形式の csproj に置くだけで通ります:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <NoWarn>CS0618;CS0168;CS0219;SYSLIB0001</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="System.Text.Encoding.CodePages" Version="9.0.0" />
  </ItemGroup>
</Project>
```

## 2. CP1252 が .NET Core に無い

静的コンストラクタが `Encoding.GetEncoding(1252)` を呼ぶので、`Main` に登録を足しても
**間に合いません**（型初期化子は Main より先に走ります）。モジュール初期化子で入れます:

```csharp
internal static class EncodingBootstrap {
    [System.Runtime.CompilerServices.ModuleInitializer]
    internal static void Init() =>
        System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
}
```

## 3. 実行

引数は**パス付きで**渡します（`Path.GetDirectoryName` が空を返すと即座に終了します）。

```bash
dotnet bestdis.dll /full/path/to/SMG2.prg
```

出力は入力と同じディレクトリの `SMG2.b1v`、61,272 行。ジョブは `^[A-Z_0-9]+#$` の行で始まります。
テレグラムは `move S1,{$32.B,$09.B,…}` の形の定数で、`xsend` の直前に組み立てられます。

## 読むときの注意

`BINAER_BUFFER` のどのバイトがテレグラムのどこへ行くかは、`move L0,#$X.L` が 2 つ続いて
`atsp L1,#$4.L` が来る並びで表現されます。1 つ目が**行き先の添字**、2 つ目が**元の添字**です。
これを取り違えると番地のバイト順が逆になります —— `docs/smg2-write-protocol.md` §2.1 の
`[4]<-0x13, [5]<-0x12, [6]<-0x11` はこの読み方で得たものです。
