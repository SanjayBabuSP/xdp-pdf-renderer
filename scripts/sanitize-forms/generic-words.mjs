// Vocabulary that never carries company information: XFA, JavaScript,
// FormCalc, Acrobat, Designer and XHTML words. A name made only of these words
// (plus digits, `_`, `-`, `.` and single letters) is kept; see names.mjs.

import { BUILTIN } from './script-literals.mjs';

const XFA_ELEMENTS = `appearanceFilter arc area assist barcode bind bindItems bookend boolean border break
  breakAfter breakBefore button calculate caption certificate certificates checkButton choiceList color comb connect
  contentArea corner date dateTime dateTimeEdit decimal defaultUi desc digestMethod digestMethods draw edge encoding
  encodings encrypt encryptData encryption encryptionMethod encryptionMethods event exclGroup exData execute exObject
  extras field fill filter float font format handler hyphenation image imageEdit instanceManager integer issuers items
  keep keyUsage line linear lockDocument manifest margin mdp medium message numericEdit occur oid oids overflow
  pageArea pageSet para passwordEdit pattern picture proto radial reason reasons rectangle ref script setProperty
  signature signData signing solid speak stipple subform subformSet subjectDN subjectDNs submit template text textEdit
  time timeStamp toolTip traversal traverse ui validate value variables connectionSet xsdConnection wsdlConnection
  xmlConnection rootElement uri soapAction soapAddress operation wsdlAddress dataDescription datasets data config
  localeSet locale xdp`;

const XFA_ATTRIBUTES = `access accessKey action activity after afterTarget allowMacro allowNeutral allowRichText
  anchorType aspect baselineShift before beforeTarget bookendLeader bookendTrailer bottomInset cap checksum circular
  colSpan columnWidths commitOn contentType credentialServerPolicy dataColumnCount dataEncipherment dataLength
  dataPrep dataRowCount delayedOpen delimiter disableAll embed embedMode embedPDF embedType endChar
  errorCorrectionLevel executeType fontHorizontalScale fontVerticalScale fracDigits from h hAlign hand highlight
  hScrollPolicy id initial inverted join kerningMode labelRef layout leadDigits leader leftInset letterSpacing
  lineHeight lineThrough lineThroughPeriod listen locale long mandatory marginLeft marginRight mark match max maxChars
  maxEntries maxH maxLength maxW min minH minW moduleHeight moduleWidth multiLine name next numberOfCells open
  orientation overflowLeader overflowTarget overflowTrailer override overline overlinePeriod placement posture
  presence previous print printCheckDigit priority radius radixOffset rate relation relevant reserve restoreState
  rightInset role rotate rowColumnRatio runAt save scope scriptTest selectedMember shape short signatureType size slope
  spaceAbove spaceBelow spacerun startAngle startNew stock stroke sweepAngle tabDefault tabStops target targetType
  textEntry textIndent textLocation thickness to topInset trailer transient truncate type typeface underline
  underlinePeriod upsMode usage use usehref uuid vAlign valueRef vScrollPolicy w weight wideNarrowRatio x y`;

const XFA_SCRIPTING = `xfa host layout form record dataWindow signature event this parent all className
  somExpression oneOfChild nodes index isContainer isNull model ns rawValue formattedValue editValue borderColor
  borderWidth fillColor fontColor errorText formatMessage mandatoryMessage validationMessage parentSubform
  instanceIndex count addInstance removeInstance insertInstance moveInstance setInstances addItem clearItems
  deleteItem boundItem getDisplayItem getSaveItem getItemState setItemState setItems selectedIndex length item append
  insert remove namedItem execEvent execCalculate execInitialize execValidate resolveNode resolveNodes assignNode
  applyXSL clone getAttribute getElement isPropertySpecified loadXML saveFilteredXML saveXML setAttribute setElement
  createNode isCompatibleNS getDelta getDeltas getInvalidObjects recalculate remerge formNodes getRect metadata
  exportData importData messageBox setFocus getFocus resetData gotoURL pageUp pageDown openList beep
  documentCountInBatch documentInBatch response currentPage numPages appType calculationsEnabled validationsEnabled
  language platform title variation version absPage absPageCount absPageCountInBatch absPageInBatch absPageSpan page
  pageContent pageCount pageSpan relayout relayoutPageArea sheet sheetCount sheetCountInBatch sheetInBatch change
  commitKey fullText keyDown modifier newContentType newText prevContentType prevText reenter selEnd selStart shift
  soapFaultCode soapFaultString cancelAction emit reset dataNode isRecord contains nullType`;

const JAVASCRIPT = `break case catch class const continue debugger default delete do else enum export extends
  false finally for function if implements import in instanceof interface let new null package private protected
  public return static super switch throw true try typeof var void while with yield undefined NaN Infinity eval isNaN
  isFinite parseInt parseFloat decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape Object
  Function Array String Boolean Number Math Date RegExp Error EvalError RangeError ReferenceError SyntaxError
  TypeError URIError JSON arguments prototype constructor toString valueOf hasOwnProperty isPrototypeOf
  propertyIsEnumerable toLocaleString charAt charCodeAt concat indexOf lastIndexOf localeCompare match replace search
  slice split substr substring toLowerCase toUpperCase toLocaleLowerCase toLocaleUpperCase trim fromCharCode join pop
  push reverse sort splice unshift abs acos asin atan atan2 ceil cos exp floor log pow random round sin sqrt tan PI E
  LN2 LN10 LOG2E LOG10E SQRT2 toFixed toPrecision toExponential MAX_VALUE MIN_VALUE getDate getDay getFullYear
  getHours getMilliseconds getMinutes getMonth getSeconds getTime getTimezoneOffset getYear setDate setFullYear
  setHours setMilliseconds setMinutes setMonth setSeconds setTime setYear toDateString toLocaleDateString
  toLocaleTimeString toTimeString toUTCString toISOString UTC parse now exec test source global ignoreCase multiline
  lastIndex message stringify apply call bind keys create`;

const ACROBAT = `app alert execMenuItem launchURL setTimeOut clearTimeOut setInterval clearInterval viewerType
  viewerVersion viewerVariation util printd printf printx scand console println show clear global color display font
  style position scale target rc willCommit changeEx`;

const FORMCALC = `Abs Avg Ceil Count Floor Max Min Mod Round Sum Date Date2Num DateFmt IsoDate2Num IsoTime2Num
  LocalDateFmt LocalTimeFmt Num2Date Num2GMTime Num2Time Time Time2Num TimeFmt Apr CTerm FV IPmt NPV Pmt PPmt PV Rate
  Term Choose Exists HasValue Oneof Within If Eval Null Ref UnitType UnitValue At Concat Decode Encode Format Left Len
  Lower Ltrim Parse Replace Right Rtrim Space Str Stuff Substr Uuid Upper WordNum Get Post Put then elseif endif
  endwhile upto downto step endfor foreach func endfunc and or not eq ne lt le gt ge infinity nan`;

const SANITIZER = `application javascript formcalc http https ftp file www example mailto zero datetime num`;

const DESIGNER = `body page pages content area master floating field embedded href untitled header footer row
  rows cell table section text image line rectangle circle button check box radio list drop down numeric decimal
  signature barcode password email submit print reset static group subform form`;

const XHTML = `html head body p span div br b i u em strong sup sub ul ol li a font table tr td th`;

/** Letter chunks split at case changes: "EBQuotationNo2" → ["EB", "Quotation", "No"]. */
export function chunksOf(name) {
  return name.match(/\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{L}+/gu) ?? [];
}

/** Adds a word and its chunks, lower-cased: "rawValue" → rawvalue, raw, value. */
export function addGenericWord(words, word) {
  if (!word) return;
  words.add(word.toLowerCase());
  for (const chunk of chunksOf(word)) words.add(chunk.toLowerCase());
}

export const GENERIC_WORDS = new Set();
for (const list of [XFA_ELEMENTS, XFA_ATTRIBUTES, XFA_SCRIPTING, JAVASCRIPT, ACROBAT, FORMCALC, SANITIZER, DESIGNER, XHTML]) {
  for (const word of list.split(/\s+/)) addGenericWord(GENERIC_WORDS, word);
}
for (const word of BUILTIN) addGenericWord(GENERIC_WORDS, word);

/** True when every letter chunk of `name` is a single letter or a generic word. */
export function isGenericName(name, extraWords) {
  return chunksOf(name).every((chunk) => {
    const word = chunk.toLowerCase();
    return [...chunk].length === 1 || GENERIC_WORDS.has(word) || Boolean(extraWords?.has(word));
  });
}
