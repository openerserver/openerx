import { forwardRef } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  useWindowDimensions,
  View,
} from "react-native";

type Props = Omit<TextInputProps, "multiline" | "numberOfLines" | "scrollEnabled"> & {
  value: string;
};

/** Native text layout sizes the frame independently of the input's scroll viewport. */
export const ComposerInput = forwardRef<TextInput, Props>(({ value, style, ...props }, ref) => {
  const { fontScale } = useWindowDimensions();
  const inputStyle = StyleSheet.flatten(style);
  const borders =
    (inputStyle?.borderTopWidth ?? inputStyle?.borderWidth ?? 0) +
    (inputStyle?.borderBottomWidth ?? inputStyle?.borderWidth ?? 0);
  const minimum = Math.ceil(24 * fontScale + 20 + borders);
  const maximum = Math.ceil(24 * fontScale * 6 + 20 + borders);
  const textStyle: TextStyle = {
    color: inputStyle?.color,
    fontFamily: inputStyle?.fontFamily,
    fontWeight: inputStyle?.fontWeight,
    fontStyle: inputStyle?.fontStyle,
    letterSpacing: inputStyle?.letterSpacing,
    textAlign: inputStyle?.textAlign,
    writingDirection: inputStyle?.writingDirection,
    paddingLeft:
      inputStyle?.paddingLeft ?? inputStyle?.paddingHorizontal ?? inputStyle?.padding ?? 0,
    paddingRight:
      inputStyle?.paddingRight ?? inputStyle?.paddingHorizontal ?? inputStyle?.padding ?? 0,
  };
  return (
    <View style={[style, styles.frame, { minHeight: minimum, maxHeight: maximum }]}>
      {/* Measuring outside TextInput avoids Fabric's fixed-height/content-size
            feedback loop and also reflows restored drafts and width changes.
            The sentinel preserves an empty final line after a trailing newline. */}
      <Text
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        allowFontScaling={props.allowFontScaling}
        maxFontSizeMultiplier={props.maxFontSizeMultiplier}
        numberOfLines={6}
        style={[styles.input, textStyle, styles.measure]}
      >
        {value ? `${value}\u200b` : " "}
      </Text>
      <TextInput
        {...props}
        ref={ref}
        value={value}
        multiline
        underlineColorAndroid="transparent"
        scrollEnabled
        style={[styles.input, textStyle, styles.overlay]}
      />
    </View>
  );
});
ComposerInput.displayName = "ComposerInput";

const styles = StyleSheet.create({
  frame: {
    height: "auto",
    padding: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: 0,
  },
  measure: { opacity: 0 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  input: {
    fontSize: 16,
    lineHeight: 24,
    paddingTop: 10,
    paddingBottom: 10,
    includeFontPadding: false,
    textAlignVertical: "top",
  },
});
